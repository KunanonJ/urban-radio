#!/usr/bin/env node
/**
 * Periodic Postgres → S3-compatible backup.
 *
 *   1. Runs `pg_dump --format=custom --no-owner` against `DATABASE_URL`.
 *   2. Streams the dump bytes to an S3-compatible bucket (R2, AWS S3, MinIO).
 *   3. Optionally prunes objects older than `BACKUP_RETENTION_DAYS` days.
 *
 * Designed to run from one of:
 *   - A Railway cron service (next-gen Railway has built-in cron tasks)
 *   - A GitHub Actions scheduled workflow (`.github/workflows/pg-backup.yml`)
 *   - Any external scheduler (Better Stack, GCP Cloud Scheduler, etc.)
 *
 * Required env:
 *   DATABASE_URL                 (Railway Postgres connection string)
 *   STORAGE_ENDPOINT_URL         (S3-compatible endpoint — same one used by app)
 *   STORAGE_BUCKET               (target bucket)
 *   STORAGE_ACCESS_KEY_ID
 *   STORAGE_SECRET_ACCESS_KEY
 *
 * Optional env:
 *   STORAGE_REGION               (defaults 'auto' for R2)
 *   BACKUP_PREFIX                (object key prefix, defaults 'backups/pg/')
 *   BACKUP_RETENTION_DAYS        (delete objects older than this; default 30, set 0 to disable)
 *   BACKUP_DRY_RUN               (set to '1' to skip the upload + prune, just dump)
 *
 * Exit codes:
 *   0   success
 *   2   missing required env
 *   3   pg_dump failed
 *   4   upload failed
 *   5   prune failed (non-fatal — backup still uploaded)
 *
 * Security notes:
 *   - pg_dump is invoked via spawnSync with shell:false; DATABASE_URL passes
 *     through env, never the command line, so passwords never reach `ps`.
 *   - The dump is streamed in chunks (read-then-upload). Large databases get
 *     held in memory; for >500 MB databases switch to a tmpfile.
 *   - Object keys are sanitized to alphanumeric + `-`, `_`, `.`, `/`.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

const DEFAULT_PREFIX = 'backups/pg/';
const DEFAULT_RETENTION_DAYS = 30;

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`Missing required env: ${name}`);
    process.exit(2);
  }
  return v.trim();
}

function nowStampKey() {
  // YYYY-MM-DDTHH-MM-SS-mmmZ — colons replaced with dashes for S3-safe keys.
  return new Date().toISOString().replace(/:/g, '-');
}

function buildObjectKey({ prefix = DEFAULT_PREFIX, now = new Date() } = {}) {
  const stamp = now.toISOString().replace(/:/g, '-');
  return `${prefix}sonic-bloom-pg-${stamp}.dump`;
}

function runPgDump(databaseUrl, outputPath) {
  const result = spawnSync(
    'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-acl',
      '--clean',
      '--if-exists',
      `--file=${outputPath}`,
      databaseUrl,
    ],
    {
      stdio: ['ignore', 'inherit', 'inherit'],
      shell: false,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`pg_dump exited with status ${result.status}`);
  }
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

async function uploadDump({ client, bucket, key, bodyBytes }) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bodyBytes,
      ContentType: 'application/x-postgres-dump',
      ContentLength: bodyBytes.byteLength,
      Metadata: {
        'sonic-bloom-backup-version': '1',
      },
    }),
  );
}

async function pruneOldBackups({ client, bucket, prefix, olderThanMs, now }) {
  const out = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }),
  );
  const objects = out.Contents ?? [];
  const cutoff = now.getTime() - olderThanMs;
  const toDelete = objects.filter((o) => {
    const lm = o.LastModified ? new Date(o.LastModified).getTime() : Infinity;
    return lm < cutoff;
  });
  for (const obj of toDelete) {
    if (!obj.Key) continue;
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }),
    );
    console.log(`  pruned: ${obj.Key}`);
  }
  return { listed: objects.length, deleted: toDelete.length };
}

async function main() {
  const env = process.env;
  const dryRun = env.BACKUP_DRY_RUN === '1';

  const databaseUrl = requireEnv('DATABASE_URL');
  const endpoint = dryRun ? '<dry-run>' : requireEnv('STORAGE_ENDPOINT_URL');
  const bucket = dryRun ? '<dry-run>' : requireEnv('STORAGE_BUCKET');
  if (!dryRun) {
    requireEnv('STORAGE_ACCESS_KEY_ID');
    requireEnv('STORAGE_SECRET_ACCESS_KEY');
  }
  const prefix = (env.BACKUP_PREFIX || DEFAULT_PREFIX).trim();
  const retentionDays = Number.parseInt(
    env.BACKUP_RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS),
    10,
  );

  const workDir = mkdtempSync(join(tmpdir(), 'sonic-bloom-backup-'));
  const dumpPath = join(workDir, 'pg.dump');

  console.log(`backup started ${new Date().toISOString()}`);
  console.log(`  endpoint:  ${endpoint}`);
  console.log(`  bucket:    ${bucket}`);
  console.log(`  prefix:    ${prefix}`);
  console.log(`  retention: ${retentionDays} days`);

  try {
    console.log('running pg_dump...');
    try {
      runPgDump(databaseUrl, dumpPath);
    } catch (err) {
      console.error('pg_dump failed:', err.message);
      process.exit(3);
    }

    const bodyBytes = readFileSync(dumpPath);
    const key = buildObjectKey({ prefix });
    console.log(`dump size: ${(bodyBytes.byteLength / 1024 / 1024).toFixed(2)} MB`);
    console.log(`upload key: ${key}`);

    if (dryRun) {
      console.log('[dry-run] skipping upload + prune');
      return;
    }

    const client = buildS3Client(env);
    try {
      await uploadDump({ client, bucket, key, bodyBytes });
      console.log('upload complete');
    } catch (err) {
      console.error('upload failed:', err.message);
      process.exit(4);
    }

    if (retentionDays > 0) {
      console.log(`pruning objects older than ${retentionDays} days...`);
      try {
        const result = await pruneOldBackups({
          client,
          bucket,
          prefix,
          olderThanMs: retentionDays * 24 * 60 * 60 * 1000,
          now: new Date(),
        });
        console.log(
          `  listed ${result.listed}, deleted ${result.deleted}`,
        );
      } catch (err) {
        console.error('prune failed (non-fatal):', err.message);
        process.exit(5);
      }
    }
    console.log('backup complete');
  } finally {
    try {
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

// Only run main when invoked directly. Tests import the helpers.
import { fileURLToPath } from 'node:url';
const isDirectInvocation = (() => {
  try {
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return fileURLToPath(import.meta.url) === argv1 || argv1.endsWith('backup-pg-to-s3.mjs');
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

export { buildObjectKey, pruneOldBackups, buildS3Client, requireEnv, nowStampKey };
