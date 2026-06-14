/**
 * POST /api/presence/heartbeat
 *
 * One round-trip "I'm here" beacon. Upserts the caller's presence row keyed
 * by (station_id, user_id, target_type, target_id), best-effort sweeps stale
 * rows, and returns the post-heartbeat active session list so the client can
 * refresh its avatar stack in the same round-trip.
 *
 * Mirrors `functions/api/presence/heartbeat.ts`.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β5.
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  PRESENCE_TARGET_TYPES,
  PRESENCE_TTL_SECONDS,
  cleanupStalePresence,
  isPresenceTargetType,
  listActivePresence,
  rowToJson,
  upsertPresence,
  type PresenceTargetType,
} from '@/server/presence-queries';

export interface HeartbeatDeps {
  db?: DbClient;
  secret?: string;
  idGenerator?: () => string;
  /** Test-only `now` override (used by both upsert and list/cleanup windows). */
  now?: () => string;
}

const heartbeatSchema = z.object({
  targetType: z.enum(
    PRESENCE_TARGET_TYPES as unknown as [
      PresenceTargetType,
      ...PresenceTargetType[],
    ],
  ),
  targetId: z.string().trim().min(1).max(200),
});

export async function heartbeatHandler(
  request: Request,
  deps: HeartbeatDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = heartbeatSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  if (!isPresenceTargetType(parsed.data.targetType)) {
    return jsonError(400, 'Invalid targetType');
  }

  const id = deps.idGenerator?.() ?? randomUUID();
  const now = deps.now?.() ?? new Date().toISOString();

  try {
    await upsertPresence(db, {
      id,
      stationId: gate.context.stationId,
      userId: gate.context.userId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      now,
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'presence/heartbeat/upsert' }));
  }

  // Best-effort cleanup. Failures swallowed — another heartbeat will retry.
  try {
    await cleanupStalePresence(db, PRESENCE_TTL_SECONDS, now);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('presence/heartbeat cleanup (ignored)', err);
  }

  let sessions: Awaited<ReturnType<typeof listActivePresence>>;
  try {
    sessions = await listActivePresence(db, {
      stationId: gate.context.stationId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      now,
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'presence/heartbeat/list' }));
  }

  return jsonOk({
    sessions: sessions.map(rowToJson),
    meta: { ttlSeconds: PRESENCE_TTL_SECONDS },
  });
}

export async function POST(request: Request): Promise<Response> {
  return heartbeatHandler(request);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['POST']);
}
