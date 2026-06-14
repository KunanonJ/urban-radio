/**
 * POST /api/stream/start — start the live encoder for the caller's station.
 *
 * Mirrors `functions/api/stream/start.ts`. Only `admin` / `producer` may
 * trigger the stream control adapter. Successful starts are recorded in
 * `audit_log` (best-effort — failure does not abort the response).
 *
 * Response shape (matched byte-for-byte against Cloudflare):
 *   200 OK  → `{ ok: true, status: StreamStatus }`
 *   401     → `{ error: 'Unauthorized' }`             (no session)
 *   403     → `{ error: 'No station membership' }`    (no station_members row)
 *   403     → `{ error: 'Insufficient role for stream control' }` (non-admin/producer)
 *   500     → `{ error: <message> }`                  (adapter throws)
 *   502     → `{ ok: false, error: <message> }`       (adapter returned !ok)
 *   405     → `Method Not Allowed`                    (non-POST)
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β3.
 */

import { getDb, type DbClient } from '@/db/client';
import { jsonError, methodNotAllowed } from '@/server/api-response';
import { writeAuditLog } from '@/server/audit-log';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  getStreamControl,
  type StreamControlAdapter,
} from '@/server/stream-control';

const ALLOWED_ROLES = new Set(['admin', 'producer']);

export interface StreamStartDeps {
  db?: DbClient;
  /** Override the JWT secret (tests). */
  secret?: string;
  /** Override the stream control adapter (tests). */
  streamControl?: StreamControlAdapter;
}

export async function postStreamStart(
  request: Request,
  deps: StreamStartDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  if (!ALLOWED_ROLES.has(gate.context.role)) {
    return jsonError(403, 'Insufficient role for stream control');
  }

  const adapter =
    deps.streamControl ??
    getStreamControl({
      STREAM_CONTROL_URL: process.env.STREAM_CONTROL_URL,
      STREAM_CONTROL_KEY: process.env.STREAM_CONTROL_KEY,
    });

  let result: { ok: true } | { ok: false; error: string };
  try {
    result = await adapter.start(gate.context.stationId);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'stream/start' }));
  }

  if (!result.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: result.error }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  const status = await adapter.status(gate.context.stationId);

  const db = deps.db ?? getDb();
  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'stream_start',
    targetType: 'station',
    targetId: gate.context.stationId,
    after: { connected: status.connected, source: status.source },
  });

  return new Response(JSON.stringify({ ok: true, status }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function POST(request: Request): Promise<Response> {
  return postStreamStart(request);
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
