/**
 * Drizzle client factory for the Railway Postgres migration.
 *
 * Two modes:
 *  - Production / dev: build a Drizzle client from `DATABASE_URL`.
 *  - Tests: caller passes a `pg.Pool`-shaped object (real pool, or pg-mem
 *    `newDb().adapters.createPg()` shim) so we can run without a real Postgres.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-α step 7.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Pool as PgPool } from 'pg';
import * as schema from './schema';

export type DbSchema = typeof schema;
export type DbClient = NodePgDatabase<DbSchema>;

export interface CreateDbOptions {
  /** Explicit Postgres connection string. Overrides `process.env.DATABASE_URL`. */
  url?: string;
  /** Pre-constructed `pg.Pool` (or pg-mem shim) — skips internal pool construction. */
  pool?: PgPool;
  /** Pool size when constructing internally. Defaults to 10. */
  max?: number;
}

let cachedDefault: DbClient | null = null;

/**
 * Build a Drizzle client. Pure factory — does not cache.
 *
 * @throws Error if no pool, no url option, and no `DATABASE_URL` env var.
 */
export function createDb(opts: CreateDbOptions = {}): DbClient {
  if (opts.pool) {
    return drizzle(opts.pool, { schema });
  }

  const url = opts.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. See docs/RAILWAY-KICKOFF.md "Local dev setup".',
    );
  }

  const pool = new Pool({
    connectionString: url,
    max: opts.max ?? 10,
  });
  return drizzle(pool, { schema });
}

/**
 * Returns a cached Drizzle client backed by `DATABASE_URL`.
 *
 * Idempotent — repeated calls reuse the same pool. Intended for the Next.js
 * server runtime; do not call from client components.
 */
export function getDb(): DbClient {
  if (cachedDefault) return cachedDefault;
  cachedDefault = createDb();
  return cachedDefault;
}

/**
 * Test-only escape hatch: clear the cached default client so the next
 * `getDb()` call rebuilds it. Useful between vitest suites that mutate
 * `process.env.DATABASE_URL` or that re-mock `pg.Pool`.
 */
export function __resetDbCacheForTests(): void {
  cachedDefault = null;
}
