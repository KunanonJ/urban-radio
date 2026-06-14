/**
 * Station-membership gate for Next.js Route Handlers.
 *
 * Mirrors `functions/_lib/require-station.ts` but queries Drizzle/Postgres
 * instead of D1. Returns the same shape so call sites read the same.
 *
 * Multi-station selection (e.g. `X-Station-Id` header) remains out of scope
 * for the migration window; the user's first station ordered by
 * `(created_at, station_id)` is returned for determinism — matching the
 * legacy Cloudflare behaviour.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { asc, eq } from 'drizzle-orm';

import { getDb, type DbClient } from '@/db/client';
import { stationMembers } from '@/db/schema';
import { jsonError } from '@/server/api-response';
import { logAndScrub } from '@/server/internal-error';

import { getSessionFromRequest } from './session-jwt';

export interface StationContext {
  userId: string;
  username: string;
  stationId: string;
  role: string;
}

export type StationGateResult =
  | { ok: true; context: StationContext }
  | { ok: false; response: Response };

export interface RequireStationOptions {
  /** Override the Drizzle client (tests pass a pg-mem-backed instance). */
  db?: DbClient;
  /** Override the JWT secret (defaults to `process.env.AUTH_JWT_SECRET`). */
  secret?: string;
}

/**
 * Resolve the authenticated user's station membership.
 *
 *  - 401 if `AUTH_JWT_SECRET` is missing or the session is invalid.
 *  - 403 if the session is valid but the user belongs to no station.
 *  - 500 if the membership lookup throws.
 */
export async function requireStation(
  request: Request,
  opts: RequireStationOptions = {},
): Promise<StationGateResult> {
  const secret = (opts.secret ?? process.env.AUTH_JWT_SECRET ?? '').trim();
  if (!secret) {
    return { ok: false, response: jsonError(401, 'Unauthorized') };
  }

  const session = await getSessionFromRequest(request, secret);
  if (!session?.sub) {
    return { ok: false, response: jsonError(401, 'Unauthorized') };
  }

  const db = opts.db ?? getDb();
  let row: { stationId: string; role: string } | undefined;
  try {
    const rows = await db
      .select({
        stationId: stationMembers.stationId,
        role: stationMembers.role,
      })
      .from(stationMembers)
      .where(eq(stationMembers.userId, session.sub))
      .orderBy(asc(stationMembers.createdAt), asc(stationMembers.stationId))
      .limit(1);
    row = rows[0];
  } catch (err) {
    return {
      ok: false,
      response: jsonError(
        500,
        logAndScrub(err, { tag: 'requireStation', publicMessage: 'Membership lookup failed' }),
      ),
    };
  }

  if (!row) {
    return { ok: false, response: jsonError(403, 'No station membership') };
  }

  return {
    ok: true,
    context: {
      userId: session.sub,
      username: session.username,
      stationId: row.stationId,
      role: row.role,
    },
  };
}
