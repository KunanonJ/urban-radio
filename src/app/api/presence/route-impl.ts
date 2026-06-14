/**
 * GET /api/presence?targetType=&targetId=
 *
 * Read-only listing of active presence sessions for one polymorphic target.
 * Active means the heartbeat is at most `PRESENCE_TTL_SECONDS` (15s) old.
 * Station scope is enforced by `requireStation` so cross-tenant probes are
 * structurally impossible.
 *
 * Mirrors `functions/api/presence/index.ts`.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β5.
 */

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  PRESENCE_TARGET_TYPES,
  PRESENCE_TTL_SECONDS,
  isPresenceTargetType,
  listActivePresence,
  rowToJson,
  type PresenceTargetType,
} from '@/server/presence-queries';

export interface PresenceDeps {
  db?: DbClient;
  secret?: string;
  /** Test-only `now` override threaded into the time-window helpers. */
  now?: () => string;
}

const listQuerySchema = z.object({
  targetType: z.enum(
    PRESENCE_TARGET_TYPES as unknown as [
      PresenceTargetType,
      ...PresenceTargetType[],
    ],
  ),
  targetId: z.string().trim().min(1).max(200),
});

export async function listPresenceHandler(
  request: Request,
  deps: PresenceDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  const url = new URL(request.url);
  const parsed = listQuerySchema.safeParse({
    targetType: url.searchParams.get('targetType') ?? undefined,
    targetId: url.searchParams.get('targetId') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, 'Invalid query parameters', parsed.error.flatten());
  }

  if (!isPresenceTargetType(parsed.data.targetType)) {
    return jsonError(400, 'Invalid targetType');
  }

  try {
    const rows = await listActivePresence(db, {
      stationId: gate.context.stationId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      now: deps.now?.(),
    });
    return jsonOk({
      sessions: rows.map(rowToJson),
      meta: { ttlSeconds: PRESENCE_TTL_SECONDS },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'presence/list' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return listPresenceHandler(request);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['GET']);
}
