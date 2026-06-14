#!/usr/bin/env node
/**
 * Phase 8 — D1 → R2 backup script.
 *
 * What it does:
 *   1. `wrangler d1 export <db> --output=<tmpFile>` — dumps the remote D1 database
 *      to a local SQL file.
 *   2. `wrangler r2 object put <bucket>/<key> --file=<tmpFile>` — uploads it.
 *   3. Logs success/failure with a UTC-ISO timestamp.
 *
 * Environment:
 *   BACKUP_BUCKET   R2 bucket name to put backups in. Falls back to MEDIA_BUCKET
 *                   (the wrangler.toml r2 binding name) with a warning.
 *   BACKUP_DB_NAME  D1 database name (defaults to `sonic-bloom-db`).
 *   BACKUP_PREFIX   Optional key prefix; default `backups/`.
 *
 * Run locally:
 *   BACKUP_BUCKET=sonic-bloom-media node scripts/backup-d1-to-r2.mjs
 *
 * Run from cron (see docs/PRODUCTION-RUNBOOK.md for CF Cron / GitHub Actions
 * recipes). This script is a NO-OP without `wrangler` installed and with no
 * Cloudflare credentials — it'll fail loudly with a clear error.
 *
 * Security: we call wrangler via spawnSync with an argv array (no shell),
 * so env-derived values are never interpolated into a shell command.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_DB = 'sonic-bloom-db';
const DEFAULT_PREFIX = 'backups/';
const FALLBACK_BUCKET = 'sonic-bloom-media';

/**
 * Returns an ISO-8601 timestamp safe for use in object keys:
 * `2026-05-14T21-30-00-000Z` (`:` replaced with `-`).
 */
export function backupTimestamp(now = new Date()) {
  return now.toISOString().replace(/:/g, '-');
}

export function buildBackupKey({
  prefix = DEFAULT_PREFIX,
  dbName = DEFAULT_DB,
  now = new Date(),
} = {}) {
  const stamp = backupTimestamp(now);
  return `${prefix}${dbName}-${stamp}.sql`;
}

export function resolveConfig(env = process.env) {
  const dbName = (env.BACKUP_DB_NAME || DEFAULT_DB).trim();
  const prefix = (env.BACKUP_PREFIX || DEFAULT_PREFIX).trim();
  const bucketRaw = (env.BACKUP_BUCKET || '').trim();
  const warnings = [];
  let bucket = bucketRaw;
  if (!bucket) {
    bucket = FALLBACK_BUCKET;
    warnings.push(
      `BACKUP_BUCKET not set — falling back to "${FALLBACK_BUCKET}" (the MEDIA_BUCKET name from wrangler.toml). Set BACKUP_BUCKET explicitly in production.`,
    );
  }
  return { dbName, prefix, bucket, warnings };
}

/**
 * Shell-free wrangler invocation. spawnSync with shell:false means env-derived
 * values can never escape into command interpretation.
 */
export function runWrangler(args, opts = {}) {
  const result = spawnSync('wrangler', args, {
    encoding: 'utf8',
    stdio: opts.silent ? 'pipe' : 'inherit',
    shell: false,
    ...opts,
  });
  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(
      `wrangler ${args.join(' ')} exited with status ${result.status}: ${result.stderr ?? ''}`,
    );
  }
  return result;
}

/**
 * The main entrypoint. Returns a result object — never throws.
 */
export async function backup({
  env = process.env,
  now = new Date(),
  // Test seam — DI for the wrangler runner.
  run = runWrangler,
  // Where to write the temp SQL dump.
  workdirFactory = () => mkdtempSync(join(tmpdir(), 'sonic-bloom-backup-')),
  // Test seam — file existence check.
  fileExists = existsSync,
} = {}) {
  const { dbName, prefix, bucket, warnings } = resolveConfig(env);
  for (const w of warnings) console.warn(`[backup] ${w}`);

  const key = buildBackupKey({ prefix, dbName, now });
  let workdir = '';
  let dumpPath = '';

  try {
    workdir = workdirFactory();
    dumpPath = join(workdir, 'dump.sql');

    console.info(`[backup] dumping D1 "${dbName}" to ${dumpPath}`);
    run(['d1', 'export', dbName, '--remote', `--output=${dumpPath}`]);

    if (!fileExists(dumpPath)) {
      throw new Error(`Expected dump file at ${dumpPath} but it was not created`);
    }

    console.info(`[backup] uploading to R2 ${bucket}/${key}`);
    run(['r2', 'object', 'put', `${bucket}/${key}`, `--file=${dumpPath}`, '--remote']);

    console.info(`[backup] success: r2://${bucket}/${key}`);
    return { ok: true, key, bucket, dbName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[backup] FAILED: ${message}`);
    return { ok: false, error: message, key, bucket, dbName };
  } finally {
    if (workdir) {
      try {
        rmSync(workdir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('[backup] cleanup failed', cleanupErr);
      }
    }
  }
}

// CLI entrypoint (only runs when invoked directly, not when imported by tests).
const invokedAsScript =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('backup-d1-to-r2.mjs');

if (invokedAsScript) {
  backup().then((result) => {
    process.exit(result.ok ? 0 : 1);
  });
}
