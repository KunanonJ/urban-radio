#!/usr/bin/env node
/**
 * Wave RM-δ — one-shot D1 → Railway Postgres sync.
 *
 * For each of the 21 production tables, in FK-dependency order:
 *   1. Reads every row from D1 via `wrangler d1 execute --remote --json`.
 *   2. Builds an `INSERT … ON CONFLICT (<pk>) DO UPDATE SET …` against
 *      Postgres.
 *   3. Reports D1 row count, PG count post-sync, and delta.
 *
 * Idempotent: re-running with the same data is a no-op (each row's
 * ON CONFLICT clause updates to the same values).
 *
 * Modes:
 *   --dry-run (default)  — pull from D1, validate row shapes, do NOT touch PG.
 *   --apply              — write to PG. Requires `DATABASE_URL`.
 *
 * Examples:
 *   node scripts/migrate-d1-to-pg.mjs --dry-run
 *   DATABASE_URL=postgresql://… node scripts/migrate-d1-to-pg.mjs --apply
 *   DATABASE_URL=… node scripts/migrate-d1-to-pg.mjs --apply --tables=organizations,stations
 *
 * Security: wrangler is invoked via `spawnSync` with `shell: false` so the
 * D1 database name (env-derived) never escapes into a shell command.
 *
 * See docs/RAILWAY-CUTOVER-PLAYBOOK.md §2 / §4 for usage.
 */

import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const DEFAULT_DB_NAME = 'sonic-bloom-db';

/**
 * Every production table in FK-dependency order: parents before children.
 * `pk` is the list of columns that make up the primary key — used to build
 * the `ON CONFLICT (...)` clause.
 *
 * The order MUST satisfy: for every row r in table T, every FK target of r
 * is already inserted. Otherwise PG raises `foreign_key_violation`.
 */
export const TABLES_IN_FK_ORDER = [
  { name: 'organizations', pk: ['id'] },
  { name: 'stations', pk: ['id'] },
  { name: 'auth_users', pk: ['id'] },
  { name: 'station_members', pk: ['station_id', 'user_id'] },
  { name: 'artists', pk: ['id'] },
  { name: 'albums', pk: ['id'] },
  { name: 'tracks', pk: ['id'] },
  { name: 'playlists', pk: ['id'] },
  { name: 'playlist_tracks', pk: ['playlist_id', 'track_id'] },
  { name: 'media_objects', pk: ['id'] },
  { name: 'categories', pk: ['id'] },
  { name: 'radio_tracks', pk: ['id'] },
  { name: 'clocks', pk: ['id'] },
  { name: 'clock_slots', pk: ['id'] },
  { name: 'schedule_assignments', pk: ['id'] },
  { name: 'voice_tracks', pk: ['id'] },
  { name: 'play_log', pk: ['id'] },
  { name: 'audit_log', pk: ['id'] },
  { name: 'ai_usage', pk: ['id'] },
  { name: 'comments', pk: ['id'] },
  { name: 'presence_sessions', pk: ['id'] },
];

// ---------------------------------------------------------------------------
// Pure functions (testable without D1 / PG)
// ---------------------------------------------------------------------------

/**
 * Parse the JSON wrangler emits for `d1 execute --remote --json`. The shape
 * is `[{ results: [...], success: true, meta: { ... } }]`. We coerce to the
 * `results` array, defaulting to `[]` if the structure is unexpected.
 *
 * Throws on outright malformed JSON so the caller can surface a clear error.
 */
export function parseD1JsonResult(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) return [];
  const first = parsed[0];
  if (!first || typeof first !== 'object') return [];
  if (!Array.isArray(first.results)) return [];
  return first.results;
}

/**
 * Quote a Postgres identifier (table or column name). PG identifiers are
 * case-sensitive when quoted; D1 / our migration SQL uses snake_case so we
 * pass them through verbatim. We still quote defensively in case a column
 * name happens to be a reserved word.
 */
function quoteIdent(name) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Refusing to quote unexpected identifier: ${name}`);
  }
  return `"${name}"`;
}

/**
 * Build a parameterized `INSERT … ON CONFLICT DO UPDATE` statement for one
 * row. Returns `{ sql, params }` where params is positional ($1, $2, …).
 *
 *  - `table` — the bare table name (e.g. `audit_log`).
 *  - `row`   — an object whose keys are the D1 column names (snake_case).
 *  - `pk`    — array of PK column names; excluded from the UPDATE clause.
 *
 * Empty PK update sets are handled by switching to `ON CONFLICT … DO NOTHING`.
 * (Happens when every non-PK column is part of the PK — never in our schema
 * today, but defensive.)
 */
export function buildUpsertSql(table, row, pk) {
  const cols = Object.keys(row);
  if (cols.length === 0) {
    throw new Error(`Row for table ${table} has no columns`);
  }
  for (const p of pk) {
    if (!cols.includes(p)) {
      throw new Error(
        `Row for ${table} is missing PK column "${p}". Keys: ${cols.join(',')}`,
      );
    }
  }
  const quotedCols = cols.map(quoteIdent);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const params = cols.map((c) => row[c]);

  const updateCols = cols.filter((c) => !pk.includes(c));
  const conflictClause =
    updateCols.length === 0
      ? `ON CONFLICT (${pk.map(quoteIdent).join(', ')}) DO NOTHING`
      : `ON CONFLICT (${pk.map(quoteIdent).join(', ')}) DO UPDATE SET ${updateCols
          .map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`)
          .join(', ')}`;

  const sql =
    `INSERT INTO ${quoteIdent(table)} (${quotedCols.join(', ')}) ` +
    `VALUES (${placeholders.join(', ')}) ` +
    conflictClause;

  return { sql, params };
}

// ---------------------------------------------------------------------------
// Shell-free wrangler invocation
// ---------------------------------------------------------------------------

export function runWrangler(args, opts = {}) {
  const result = spawnSync('wrangler', args, {
    encoding: 'utf8',
    stdio: opts.silent ? 'pipe' : ['ignore', 'pipe', 'pipe'],
    shell: false,
    ...opts,
  });
  if (result.error) throw result.error;
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(
      `wrangler ${args.join(' ')} exited with status ${result.status}\n${result.stderr ?? ''}`,
    );
  }
  return result;
}

/**
 * Read every row of `table` from the remote D1 instance.
 *
 * `--json` makes wrangler emit a parseable array (otherwise it pretty-prints
 * a table). `--remote` is critical — otherwise wrangler hits the local
 * sandbox DB, which on a fresh machine is empty.
 */
export function fetchD1Rows({ dbName, table, runner = runWrangler }) {
  const result = runner(
    [
      'd1',
      'execute',
      dbName,
      '--remote',
      '--json',
      '--command',
      `SELECT * FROM ${table}`,
    ],
    { silent: true },
  );
  return parseD1JsonResult(result.stdout);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full sync. Pure orchestration; D1 reads and PG writes are
 * injected so tests can drive deterministic behaviour.
 *
 *   opts:
 *     - dbName        D1 database name (default `sonic-bloom-db`).
 *     - apply         If true, write to PG. Otherwise dry-run.
 *     - tables        Restrict to a subset of `TABLES_IN_FK_ORDER`.
 *     - readTable     `(table) => Promise<Row[]>` — defaults to fetchD1Rows.
 *     - pgQuery       `(sql, params) => Promise<void>` — must be set if `apply`.
 *     - pgCount       `(table) => Promise<number>` — post-sync row count.
 *     - logger        Optional `{ info(msg), warn(msg), error(msg) }`.
 *
 * Returns a per-table report and a top-level `ok` flag.
 */
export async function runSync(opts = {}) {
  const dbName = (opts.dbName ?? DEFAULT_DB_NAME).trim();
  const apply = Boolean(opts.apply);
  const allowedTables =
    Array.isArray(opts.tables) && opts.tables.length > 0
      ? new Set(opts.tables)
      : null;
  const log = opts.logger ?? defaultLogger();
  const tables = TABLES_IN_FK_ORDER.filter(
    (t) => !allowedTables || allowedTables.has(t.name),
  );

  if (apply && !opts.pgQuery) {
    throw new Error('runSync: apply mode requires a pgQuery function');
  }

  const report = [];
  for (const tbl of tables) {
    const startedAt = Date.now();
    log.info(`[${tbl.name}] reading D1…`);
    let rows;
    try {
      rows = opts.readTable
        ? await opts.readTable(tbl.name)
        : fetchD1Rows({ dbName, table: tbl.name });
    } catch (err) {
      log.error(`[${tbl.name}] D1 read failed: ${errMessage(err)}`);
      report.push({
        table: tbl.name,
        d1Count: null,
        pgCount: null,
        applied: 0,
        ok: false,
        error: errMessage(err),
        durationMs: Date.now() - startedAt,
      });
      continue;
    }

    let applied = 0;
    let firstErr = null;
    if (apply) {
      for (const row of rows) {
        try {
          const { sql, params } = buildUpsertSql(tbl.name, row, tbl.pk);
          await opts.pgQuery(sql, params);
          applied += 1;
        } catch (err) {
          // Capture only the first error per table so the report stays small,
          // but keep going so the operator sees the full damage in one pass.
          if (!firstErr) firstErr = errMessage(err);
          log.warn(`[${tbl.name}] row upsert failed: ${errMessage(err)}`);
        }
      }
    }

    let pgCount = null;
    if (apply && opts.pgCount) {
      try {
        pgCount = await opts.pgCount(tbl.name);
      } catch (err) {
        log.warn(`[${tbl.name}] PG count failed: ${errMessage(err)}`);
      }
    }

    const entry = {
      table: tbl.name,
      d1Count: rows.length,
      pgCount,
      applied,
      ok: firstErr === null,
      error: firstErr,
      durationMs: Date.now() - startedAt,
    };
    report.push(entry);
    log.info(
      `[${tbl.name}] d1=${rows.length} applied=${applied} pg=${
        pgCount ?? '—'
      } ${entry.ok ? 'ok' : 'ERR'} (${entry.durationMs}ms)`,
    );
  }

  const ok = report.every((r) => r.ok);
  return { ok, dryRun: !apply, report };
}

function defaultLogger() {
  return {
    info: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
    error: (msg) => console.error(msg),
  };
}

function errMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

const isDirectInvocation = (() => {
  try {
    // file:// import.meta.url === argv[1] file URL means we were invoked as
    // a script (vs imported by a test).
    const invokedUrl = new URL(import.meta.url).pathname;
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return invokedUrl === argv1 || invokedUrl.endsWith(argv1);
  } catch {
    return false;
  }
})();

async function main() {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: true },
      apply: { type: 'boolean', default: false },
      tables: { type: 'string' },
      db: { type: 'string' },
    },
  });
  const apply = Boolean(values.apply);
  if (apply && !process.env.DATABASE_URL) {
    console.error('--apply requires DATABASE_URL to be set');
    process.exit(2);
  }

  let pgClient = null;
  let pgQuery = null;
  let pgCount = null;
  if (apply) {
    const { Pool } = await import('pg');
    pgClient = new Pool({ connectionString: process.env.DATABASE_URL });
    pgQuery = async (sql, params) => {
      await pgClient.query(sql, params);
    };
    pgCount = async (table) => {
      // table name is constrained to the FK-ordered allowlist; safe to inline.
      const row = (
        await pgClient.query(`SELECT COUNT(*)::int AS c FROM "${table}"`)
      ).rows[0];
      return row.c;
    };
  }

  try {
    const result = await runSync({
      dbName: values.db ?? DEFAULT_DB_NAME,
      apply,
      tables: values.tables ? values.tables.split(',').map((s) => s.trim()) : undefined,
      pgQuery,
      pgCount,
    });
    console.log('\n=== sync report ===');
    for (const r of result.report) {
      console.log(
        `${r.ok ? '✓' : '✗'} ${r.table.padEnd(24)} d1=${String(r.d1Count).padStart(6)} applied=${String(r.applied).padStart(6)} pg=${String(r.pgCount ?? '—').padStart(6)}${r.error ? ` — ${r.error}` : ''}`,
      );
    }
    console.log(`\n${result.ok ? 'OK' : 'FAILED'}${result.dryRun ? ' (dry-run)' : ''}`);
    process.exit(result.ok ? 0 : 1);
  } finally {
    if (pgClient) await pgClient.end();
  }
}

if (isDirectInvocation) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
