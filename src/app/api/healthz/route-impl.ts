/**
 * GET /api/healthz — uptime-monitor probe.
 *
 * Mirrors `functions/api/healthz.ts`. Bare `{ ok, ts }` by default;
 * with `?probe=db` actively pings Postgres (slow path).
 *
 * Public per `requireAppSession.isPublicApiRoute`.
 */

import { sql } from 'drizzle-orm';

import { getDb, type DbClient } from '@/db/client';
import { jsonOk } from '@/server/api-response';

interface HealthzResponse {
  ok: boolean;
  ts: number;
  db?: 'connected' | 'unavailable' | 'error';
}

interface HealthzDeps {
  db?: DbClient;
  /** When set, force the "DB unavailable" branch (tests). */
  dbUnavailable?: boolean;
}

export async function getHealthz(
  request: Request,
  deps: HealthzDeps = {},
): Promise<Response> {
  const url = new URL(request.url);
  const probe = url.searchParams.get('probe');

  const ts = Date.now();

  if (probe !== 'db') {
    return jsonOk<HealthzResponse>({ ok: true, ts });
  }

  if (deps.dbUnavailable) {
    return jsonOk<HealthzResponse>(
      { ok: false, ts, db: 'unavailable' },
      { status: 503 },
    );
  }

  try {
    const db = deps.db ?? getDb();
    await db.execute(sql`SELECT 1`);
    return jsonOk<HealthzResponse>({ ok: true, ts, db: 'connected' });
  } catch (err) {
    // eslint-disable-next-line no-console -- production observability
    console.error('[healthz] DB probe failed', err);
    return jsonOk<HealthzResponse>(
      { ok: false, ts, db: 'error' },
      { status: 503 },
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return getHealthz(request);
}
