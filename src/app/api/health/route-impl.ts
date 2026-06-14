/**
 * GET /api/health — operational status report.
 *
 * Mirrors `functions/api/health.ts` for the Railway migration.
 * No auth required (public per `requireAppSession.isPublicApiRoute`).
 *
 * **Pentest M-16 + M-18:** the legacy response included `schemaVersion`,
 * `trackCount`, and `r2: 'bound'/'unbound'`. Each of these is a useful
 * reconnaissance signal for an attacker (cross-tenant track count
 * leakage, schema version → CVE targeting, storage configuration). The
 * response is now intentionally minimal for unauthenticated callers and
 * returns the verbose data only when called with a valid session
 * (which is the actual operator/dashboard use case).
 */

import { sql } from 'drizzle-orm';

import { getDb, type DbClient } from '@/db/client';
import { jsonOk } from '@/server/api-response';
import { getSessionFromRequest } from '@/server/auth/session-jwt';
import { SCHEMA_VERSION } from '@/server/stream-control';

interface HealthDeps {
  db?: DbClient;
  /** Override JWT secret (tests). */
  secret?: string;
}

export async function getHealth(
  request: Request | undefined = undefined,
  deps: HealthDeps = {},
): Promise<Response> {
  // Authenticated callers get the verbose snapshot; everyone else gets
  // the minimal "service is up" response. Mirrors common practice for
  // public health probes — load balancers + uptime monitors only need
  // a 200 with `{ ok: true }`.
  let isAuthed = false;
  if (request) {
    const secret = (deps.secret ?? process.env.AUTH_JWT_SECRET ?? '').trim();
    if (secret) {
      const session = await getSessionFromRequest(request, secret);
      isAuthed = Boolean(session?.sub);
    }
  }

  let dbOk = false;
  let trackCount = 0;
  try {
    const db = deps.db ?? getDb();
    await db.execute(sql`SELECT 1`);
    dbOk = true;
    if (isAuthed) {
      const rows = (await db.execute(
        sql`SELECT COUNT(*)::int AS c FROM tracks`,
      )) as unknown as { rows?: Array<{ c: number }> } | Array<{ c: number }>;
      const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
      trackCount = list[0]?.c ?? 0;
    }
  } catch {
    dbOk = false;
  }

  if (!isAuthed) {
    // Minimal public response — just enough for a load balancer.
    return jsonOk({
      ok: true,
      service: 'sonic-bloom',
      time: new Date().toISOString(),
      db: dbOk ? 'connected' : 'unavailable',
    });
  }

  const r2Ok = Boolean(
    process.env.STORAGE_ENDPOINT_URL ?? process.env.R2_S3_ENDPOINT,
  );

  return jsonOk({
    ok: true,
    service: 'sonic-bloom',
    time: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    db: dbOk ? 'connected' : 'unavailable',
    trackCount,
    r2: r2Ok ? 'bound' : 'unbound',
  });
}

export async function GET(request: Request): Promise<Response> {
  return getHealth(request);
}
