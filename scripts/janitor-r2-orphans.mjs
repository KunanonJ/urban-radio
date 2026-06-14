#!/usr/bin/env node
/**
 * M-07 — orphan-storage janitor for the S3-compatible media bucket.
 *
 * The app's compensating storage deletes are fire-and-forget: if an R2 delete
 * fails after the DB row is gone (or a DB insert fails after the object lands),
 * the object becomes a permanent orphan with no recovery path. This janitor
 * closes that gap by reconciling the bucket against every DB key reference and
 * deleting only confirmed orphans that are older than a grace window.
 *
 *   1. Lists every object in the bucket (ListObjectsV2, paginated).
 *   2. Builds the referenced-key Set from the four columns that hold R2 keys.
 *   3. For each object, computes isOrphan(): unreferenced AND past the grace
 *      window AND datable. Reports counts.
 *   4. DRY RUN by default. Only deletes when JANITOR_APPLY === '1'.
 *
 * Key producers (verified against src + schema, 2026-06-14):
 *   - 'uploads/<id>/<name>'                        src/app/api/upload/route-impl.ts
 *   - 'stations/<stationId>/voice-tracks/<id>.<ext>'  src/server/voice-track-queries.ts
 *
 * Referenced-key columns:
 *   tracks.media_r2_key | radio_tracks.storage_key
 *   voice_tracks.storage_key | media_objects.r2_key
 *
 * SAFETY (this tool issues irreversible deletes):
 *   - Dry-run unless JANITOR_APPLY === '1'.
 *   - Grace window (default 7 days) protects in-flight uploads whose DB row has
 *     not committed yet. Voice tracks in 'pending' status already own a
 *     storage_key row, so they read as 'referenced' — no special case needed.
 *   - Objects with no LastModified are never deleted (we cannot date them).
 *   - A single delete failure is logged and the sweep continues.
 *
 * RISK — if a NEW key producer or a NEW key-bearing column is added to the app
 * and is NOT registered in REFERENCE_QUERIES below, this janitor will treat its
 * objects as orphans and delete them. Keep this list in lockstep with the schema.
 *
 * Required env:
 *   DATABASE_URL
 *   STORAGE_ENDPOINT_URL
 *   STORAGE_BUCKET
 *   STORAGE_ACCESS_KEY_ID
 *   STORAGE_SECRET_ACCESS_KEY
 *
 * Optional env:
 *   STORAGE_REGION          (defaults 'auto' for R2)
 *   STORAGE_FORCE_PATH_STYLE (set '0' to disable path-style; default on)
 *   JANITOR_GRACE_HOURS     (delete only objects older than this; default 168 = 7 days)
 *   JANITOR_APPLY           (set '1' to actually delete; anything else = DRY RUN)
 *
 * Exit codes:
 *   0   success (dry-run or apply)
 *   2   missing required env
 *   3   listing / reference-build failed
 */

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import pg from 'pg';

const { Pool } = pg;

const DEFAULT_GRACE_HOURS = 168; // 7 days

/**
 * The exhaustive set of DB columns that hold an R2 object key. Each entry is a
 * SQL SELECT that yields a single `r2_key` column. Nulls are filtered out when
 * the Set is assembled. Keep in lockstep with src/db/schema.ts.
 */
const REFERENCE_QUERIES = [
  'SELECT media_r2_key AS r2_key FROM tracks WHERE media_r2_key IS NOT NULL',
  'SELECT storage_key AS r2_key FROM radio_tracks WHERE storage_key IS NOT NULL',
  'SELECT storage_key AS r2_key FROM voice_tracks WHERE storage_key IS NOT NULL',
  'SELECT r2_key AS r2_key FROM media_objects WHERE r2_key IS NOT NULL',
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`Missing required env: ${name}`);
    process.exit(2);
  }
  return v.trim();
}

function buildS3Client(env) {
  return new S3Client({
    endpoint: env.STORAGE_ENDPOINT_URL,
    region: env.STORAGE_REGION || 'auto',
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    },
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE !== '0',
  });
}

/**
 * Pure predicate. An object is an orphan ONLY when:
 *   - its key is NOT in the referenced set, AND
 *   - it has a LastModified we can read, AND
 *   - that LastModified is older than (now - graceMs).
 * A missing LastModified yields false — we never delete what we cannot date.
 *
 * @param {{ Key?: string, LastModified?: Date | string }} object
 * @param {Set<string>} referencedKeys
 * @param {Date} now
 * @param {number} graceMs
 * @returns {boolean}
 */
function isOrphan(object, referencedKeys, now, graceMs) {
  const key = object?.Key;
  if (!key) return false;
  if (referencedKeys.has(key)) return false;

  const lm = object.LastModified;
  if (!lm) return false; // cannot date → never delete
  const modifiedMs = lm instanceof Date ? lm.getTime() : new Date(lm).getTime();
  if (Number.isNaN(modifiedMs)) return false;

  const cutoff = now.getTime() - graceMs;
  return modifiedMs < cutoff;
}

/**
 * Builds the referenced-key Set by unioning every key-bearing column. Nulls are
 * already excluded by the WHERE clauses; we defensively skip falsy values too.
 *
 * @param {{ query: (sql: string) => Promise<{ rows: Array<{ r2_key?: string }> }> }} db
 * @returns {Promise<Set<string>>}
 */
async function buildReferencedKeys(db) {
  const referenced = new Set();
  for (const sql of REFERENCE_QUERIES) {
    const { rows } = await db.query(sql);
    for (const row of rows) {
      const key = row?.r2_key;
      if (key) referenced.add(key);
    }
  }
  return referenced;
}

/**
 * Lists the whole bucket and, for each object, applies isOrphan(). In apply
 * mode it deletes confirmed orphans; in dry-run it only reports. A single
 * delete failure is logged and the sweep continues.
 *
 * @returns {Promise<{ listed: number, referenced: number, orphan: number,
 *   deleted: number, failed: number, skippedInGrace: number }>}
 */
async function sweepOrphans({
  client,
  bucket,
  referencedKeys,
  graceMs,
  now = new Date(),
  apply = false,
  logger = console,
}) {
  let listed = 0;
  let orphan = 0;
  let deleted = 0;
  let failed = 0;
  let skippedInGrace = 0;

  let continuationToken;
  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    const objects = page.Contents ?? [];

    for (const obj of objects) {
      listed += 1;
      const key = obj.Key;
      if (!key) continue;
      if (referencedKeys.has(key)) continue;

      // Unreferenced. Is it deletable, or protected by the grace/date rule?
      if (isOrphan(obj, referencedKeys, now, graceMs)) {
        orphan += 1;
        if (!apply) {
          logger.log(`  [dry-run] orphan: ${key}`);
          continue;
        }
        try {
          await client.send(
            new DeleteObjectCommand({ Bucket: bucket, Key: key }),
          );
          deleted += 1;
          logger.log(`  deleted: ${key}`);
        } catch (err) {
          failed += 1;
          logger.warn(
            `  delete failed (continuing): ${key} — ${err?.message ?? err}`,
          );
        }
      } else {
        // Unreferenced but protected: within grace window or undatable.
        skippedInGrace += 1;
      }
    }

    continuationToken = page.IsTruncated
      ? page.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return {
    listed,
    referenced: referencedKeys.size,
    orphan,
    deleted,
    failed,
    skippedInGrace,
  };
}

async function main() {
  const env = process.env;
  const apply = env.JANITOR_APPLY === '1';

  const databaseUrl = requireEnv('DATABASE_URL');
  const endpoint = requireEnv('STORAGE_ENDPOINT_URL');
  const bucket = requireEnv('STORAGE_BUCKET');
  requireEnv('STORAGE_ACCESS_KEY_ID');
  requireEnv('STORAGE_SECRET_ACCESS_KEY');

  const graceHours = Number.parseInt(
    env.JANITOR_GRACE_HOURS ?? String(DEFAULT_GRACE_HOURS),
    10,
  );
  const graceMs =
    (Number.isFinite(graceHours) ? graceHours : DEFAULT_GRACE_HOURS) *
    60 *
    60 *
    1000;

  console.log(`janitor started ${new Date().toISOString()}`);
  console.log(`  endpoint:   ${endpoint}`);
  console.log(`  bucket:     ${bucket}`);
  console.log(`  grace:      ${graceHours} hours`);
  console.log(`  mode:       ${apply ? 'APPLY (deletes enabled)' : 'DRY RUN'}`);

  const pool = new Pool({ connectionString: databaseUrl });
  const client = buildS3Client(env);

  let result;
  try {
    console.log('building referenced-key set from DB...');
    const referencedKeys = await buildReferencedKeys(pool);
    console.log(`  referenced keys: ${referencedKeys.size}`);

    console.log('sweeping bucket...');
    result = await sweepOrphans({
      client,
      bucket,
      referencedKeys,
      graceMs,
      now: new Date(),
      apply,
    });
  } catch (err) {
    console.error('janitor failed:', err?.message ?? err);
    process.exit(3);
  } finally {
    await pool.end().catch(() => {});
  }

  console.log('janitor complete');
  console.log(`  listed:          ${result.listed}`);
  console.log(`  referenced:      ${result.referenced}`);
  console.log(`  orphan:          ${result.orphan}`);
  console.log(`  deleted:         ${result.deleted}`);
  console.log(`  failed:          ${result.failed}`);
  console.log(`  skipped-in-grace:${result.skippedInGrace}`);
  if (!apply && result.orphan > 0) {
    console.log(
      `  (dry run — set JANITOR_APPLY=1 to delete the ${result.orphan} orphan(s) above)`,
    );
  }
}

// Only run main when invoked directly. Tests import the helpers.
import { fileURLToPath } from 'node:url';
const isDirectInvocation = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return (
      fileURLToPath(import.meta.url) === argv1 ||
      argv1.endsWith('janitor-r2-orphans.mjs')
    );
  } catch {
    return false;
  }
})();

if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export {
  isOrphan,
  sweepOrphans,
  buildReferencedKeys,
  buildS3Client,
  requireEnv,
  REFERENCE_QUERIES,
};
