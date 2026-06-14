/**
 * GET /api/stream/status — current encoder state for the caller's station.
 *
 * Mirrors `functions/api/stream/status.ts`. ANY station member (any role) can
 * query the status — this is a read-only endpoint used by the operator UI to
 * decide whether to show "Start"/"Stop"/"Reconnect" controls. The `requireStation`
 * gate enforces the user has at least one membership row; no audit log write.
 *
 * Response shape (matched byte-for-byte against Cloudflare):
 *   200 OK  → `{ status: StreamStatus }`
 *   401     → `{ error: 'Unauthorized' }`
 *   403     → `{ error: 'No station membership' }`
 *   500     → `{ error: <message> }`
 *   405     → `Method Not Allowed`
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β3.
 */

import { type DbClient } from '@/db/client';
import { jsonError, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  getStreamControl,
  type StreamControlAdapter,
} from '@/server/stream-control';

export interface StreamStatusDeps {
  db?: DbClient;
  secret?: string;
  streamControl?: StreamControlAdapter;
}

export async function getStreamStatusRoute(
  request: Request,
  deps: StreamStatusDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  try {
    const adapter =
      deps.streamControl ??
      getStreamControl({
        STREAM_CONTROL_URL: process.env.STREAM_CONTROL_URL,
        STREAM_CONTROL_KEY: process.env.STREAM_CONTROL_KEY,
      });
    const status = await adapter.status(gate.context.stationId);
    return new Response(JSON.stringify({ status }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'stream/status' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return getStreamStatusRoute(request);
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
