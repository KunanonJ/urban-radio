/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from './env';
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

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Resolve the authenticated user's station membership for the current request.
 *
 * - 401 if there is no valid session (or `AUTH_JWT_SECRET` is unset).
 * - 403 if the session is valid but the user is not a member of any station.
 * - 500 if the DB binding is missing.
 *
 * Multi-station selection (e.g. via `X-Station-Id` header) is out of scope
 * for Phase 1 — we return the first station the user belongs to, ordered by
 * `created_at, station_id` for determinism.
 */
export async function requireStation(
  env: SonicBloomEnv,
  request: Request,
): Promise<StationGateResult> {
  const secret = env.AUTH_JWT_SECRET?.trim();
  if (!secret) {
    return { ok: false, response: jsonError(401, 'Unauthorized') };
  }

  const session = await getSessionFromRequest(request, secret);
  if (!session || !session.sub) {
    return { ok: false, response: jsonError(401, 'Unauthorized') };
  }

  const db = env.DB;
  if (!db) {
    return { ok: false, response: jsonError(500, 'Database binding missing') };
  }

  let row: { station_id: string; role: string } | null = null;
  try {
    const { results } = await db
      .prepare(
        `SELECT station_id, role
         FROM station_members
         WHERE user_id = ?
         ORDER BY created_at ASC, station_id ASC
         LIMIT 1`,
      )
      .bind(session.sub)
      .all<{ station_id: string; role: string }>();
    row = (results ?? [])[0] ?? null;
  } catch (err) {
    return {
      ok: false,
      response: jsonError(500, err instanceof Error ? err.message : 'Membership lookup failed'),
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
      stationId: row.station_id,
      role: row.role,
    },
  };
}
