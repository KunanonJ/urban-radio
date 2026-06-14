/**
 * pg-mem-backed Drizzle harness for Next.js server-side tests.
 *
 * Each call returns a fresh in-memory Postgres seeded by replaying the
 * drizzle-kit-generated SQL under `src/db/migrations`. The same workarounds
 * as `src/db/schema.test.ts` apply:
 *  - pg-mem can't parse `(now() at time zone 'utc')::text` defaults, so
 *    those `DEFAULT` clauses are stripped (callers bind explicit ISO strings).
 *  - drizzle's `node-postgres` driver attaches options pg-mem rejects
 *    (`getTypeParser`, `rowMode: 'array'`), so we use the `pg-proxy` driver
 *    and project pg-mem's row-objects into the column-ordered arrays
 *    drizzle's `mapResultRow` expects.
 *
 * Tests that need real auth helpers can call `createTestDbWithUser()` to
 * seed an org + station + station_member + auth_user row in one step.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { drizzle, type PgRemoteDatabase } from 'drizzle-orm/pg-proxy';
import { newDb, type IMemoryDb } from 'pg-mem';

import { type DbClient } from '@/db/client';
import * as schema from '@/db/schema';

const MIGRATIONS_DIR = resolve(__dirname, '../../db/migrations');

export type TestDbSchema = typeof schema;
/**
 * Internal type of the pg-proxy adapter Drizzle returns. Identical runtime
 * surface to `NodePgDatabase` (the production driver) for everything we use:
 * `select`, `insert`, `update`, `delete`, `execute`, `transaction`. The
 * `TestDb` alias is kept for backwards compatibility — but new tests should
 * type `handle.db` as `DbClient` so route helpers accept it without casts.
 */
export type TestDb = PgRemoteDatabase<TestDbSchema>;

export interface TestDbHandle {
  mem: IMemoryDb;
  /**
   * Typed as `DbClient` (the production `NodePgDatabase<typeof schema>`)
   * because route handlers expect that exact type. At runtime this is a
   * `PgRemoteDatabase` from drizzle's pg-proxy driver — the two share the
   * same query surface, so the cast is sound for our test purposes.
   *
   * Casting once here removes the need for `as unknown as DbClient` at
   * every test site.
   */
  db: DbClient;
}

function loadMigrationSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    throw new Error(
      `No drizzle-kit migrations found under ${MIGRATIONS_DIR}. ` +
        `Run \`npx drizzle-kit generate\` first.`,
    );
  }
  return files
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n\n');
}

const MIGRATION_SQL = loadMigrationSql();

function statementsForPgMem(raw: string): string[] {
  return raw
    .replace(/DEFAULT \(now\(\) at time zone 'utc'\)::text/g, '')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseSelectColumnOrder(sqlText: string): string[] | null {
  const returning = sqlText.match(
    /returning\s+([\s\S]+?)(?:$|\s+limit\b|\s+where\b)/i,
  );
  const select = sqlText.match(/select\s+([\s\S]+?)\s+from\s/i);
  const list = returning?.[1] ?? select?.[1];
  if (!list) return null;
  const cols: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      cols.push(buf.trim());
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) cols.push(buf.trim());
  return cols.map((raw) => {
    const aliasMatch = raw.match(/as\s+"([^"]+)"\s*$/i);
    if (aliasMatch) return aliasMatch[1];
    const lastQuoted = raw.match(/"([^"]+)"\s*$/);
    if (lastQuoted) return lastQuoted[1];
    return raw.trim().replace(/^"|"$/g, '');
  });
}

/**
 * Fresh in-memory Postgres with the migration SQL replayed. No data seeded.
 */
export function createTestDb(): TestDbHandle {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  for (const stmt of statementsForPgMem(MIGRATION_SQL)) {
    mem.public.none(stmt);
  }

  const adapter = mem.adapters.createPg();
  const pool = new adapter.Pool();

  const db = drizzle(
    async (
      sqlText: string,
      params: unknown[],
      method: 'all' | 'execute',
    ) => {
      const result = (await pool.query(sqlText, params)) as {
        rows: Array<Record<string, unknown>>;
      };
      if (method === 'execute') return { rows: result.rows };
      const order = parseSelectColumnOrder(sqlText);
      if (!order) return { rows: result.rows };
      return {
        rows: result.rows.map((row) => order.map((col) => row[col])),
      };
    },
    { schema },
  );

  // Cast at the boundary — the pg-proxy and node-postgres Drizzle adapters
  // share the same query surface for everything we exercise, but TS treats
  // them as nominally distinct types. See `TestDbHandle.db` docstring.
  return { mem, db: db as unknown as DbClient };
}

export interface SeedUserOptions {
  userId?: string;
  username?: string;
  /** Pre-hashed `pbkdf2:...` string. Defaults to a fixed test hash. */
  passwordHash?: string;
  stationId?: string;
  orgId?: string;
  /**
   * One of the values allowed by `station_members.role` CHECK in
   * 0001_init / drizzle migration 0000.
   */
  role?: 'operator' | 'producer' | 'programmer' | 'admin' | 'guest_vt';
}

export interface SeededUser {
  userId: string;
  username: string;
  stationId: string;
  orgId: string;
  role: string;
}

/**
 * Convenience seeding: one org + one station + one auth user + one
 * station_members row. Returns the IDs so tests can drive subsequent assertions.
 */
export function seedAuthFixture(
  handle: TestDbHandle,
  opts: SeedUserOptions = {},
): SeededUser {
  const userId = opts.userId ?? 'user-test';
  const username = opts.username ?? 'tester';
  const stationId = opts.stationId ?? 'station-test';
  const orgId = opts.orgId ?? 'org-test';
  const role = opts.role ?? 'admin';
  const passwordHash = opts.passwordHash ?? 'pbkdf2:1:00:00';
  const now = '2026-01-01T00:00:00Z';

  handle.mem.public.none(
    `INSERT INTO organizations (id, name, plan, created_at) VALUES ('${orgId}', 'Org', 'free', '${now}')`,
  );
  handle.mem.public.none(
    `INSERT INTO stations (id, org_id, slug, name, timezone, created_at) VALUES ('${stationId}', '${orgId}', 'main', 'Main', 'UTC', '${now}')`,
  );
  handle.mem.public.none(
    `INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('${userId}', '${username}', '${passwordHash}', '${now}')`,
  );
  handle.mem.public.none(
    `INSERT INTO station_members (station_id, user_id, role, created_at) VALUES ('${stationId}', '${userId}', '${role}', '${now}')`,
  );

  return { userId, username, stationId, orgId, role };
}

/**
 * One-shot helper: create a fresh DB and seed a complete auth fixture.
 */
export function createTestDbWithUser(opts: SeedUserOptions = {}): {
  handle: TestDbHandle;
  user: SeededUser;
} {
  const handle = createTestDb();
  const user = seedAuthFixture(handle, opts);
  return { handle, user };
}
