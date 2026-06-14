/// <reference types="@cloudflare/workers-types" />

/**
 * POST /api/presence/heartbeat
 *
 * One round-trip "I'm here" beacon. The client posts
 * `{ targetType, targetId }` every ~5s while a collaborative view is mounted.
 * The handler:
 *
 *   1. Authenticates the caller via `requireStation` (401/403 on miss).
 *   2. Upserts a `presence_sessions` row keyed by
 *      (station_id, user_id, target_type, target_id), refreshing
 *      `last_heartbeat_at` to `datetime('now')`.
 *   3. Runs a best-effort cleanup of stale rows in parallel — failures are
 *      swallowed; cleanup must never abort a heartbeat.
 *   4. Returns the current active session list for that target so the
 *      caller can refresh its avatar stack in the same round-trip.
 *
 * Deferred (Phase 6.2): WebSocket/Durable Object push, CRDT edit locks,
 * "joined / left" notifications.
 */

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import {
  buildPresenceCleanup,
  buildPresenceListActive,
  buildPresenceUpsert,
  isPresenceTargetType,
  PRESENCE_TARGET_TYPES,
  PRESENCE_TTL_SECONDS,
  type PresenceTargetType,
} from '../../_lib/presence-queries';

type Ctx = { env: SonicBloomEnv; request: Request };

interface PresenceDbRow {
  id: string;
  station_id: string;
  user_id: string;
  target_type: string;
  target_id: string;
  last_heartbeat_at: string;
  created_at: string;
  username: string | null;
}

export interface PresenceSessionJson {
  id: string;
  userId: string;
  username: string | null;
  targetType: string;
  targetId: string;
  lastHeartbeatAt: string;
  createdAt: string;
}

function rowToJson(row: PresenceDbRow): PresenceSessionJson {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    targetType: row.target_type,
    targetId: row.target_id,
    lastHeartbeatAt: row.last_heartbeat_at,
    createdAt: row.created_at,
  };
}

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const heartbeatSchema = z.object({
  targetType: z.enum(
    PRESENCE_TARGET_TYPES as unknown as [PresenceTargetType, ...PresenceTargetType[]],
  ),
  targetId: z.string().trim().min(1).max(200),
});

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  const parsed = heartbeatSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  // Belt + suspenders: the enum already enforces this, but the SQL builder
  // also guards in case future callers bypass the schema.
  if (!isPresenceTargetType(parsed.data.targetType)) {
    return jsonError(400, 'Invalid targetType');
  }

  const id = crypto.randomUUID();
  let upsert: ReturnType<typeof buildPresenceUpsert>;
  try {
    upsert = buildPresenceUpsert({
      id,
      stationId: gate.context.stationId,
      userId: gate.context.userId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
    });
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid heartbeat');
  }

  try {
    await db
      .prepare(upsert.sql)
      .bind(...upsert.params)
      .run();
  } catch (err) {
    console.error('presence/heartbeat upsert', err);
    return jsonError(500, err instanceof Error ? err.message : 'heartbeat failed');
  }

  // Best-effort housekeeping. Never blocks or surfaces failures — cleanup is
  // optional and another heartbeat will retry it.
  try {
    const cleanup = buildPresenceCleanup(PRESENCE_TTL_SECONDS);
    await db.prepare(cleanup.sql).run();
  } catch (err) {
    console.error('presence/heartbeat cleanup (ignored)', err);
  }

  // Surface the post-heartbeat active list in the same round-trip so the
  // client can update its avatar stack without a separate GET.
  const list = buildPresenceListActive({
    stationId: gate.context.stationId,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
  });

  let rows: PresenceDbRow[] = [];
  try {
    const { results } = await db
      .prepare(list.sql)
      .bind(...list.params)
      .all<PresenceDbRow>();
    rows = results ?? [];
  } catch (err) {
    console.error('presence/heartbeat list', err);
    return jsonError(500, err instanceof Error ? err.message : 'list failed');
  }

  return Response.json({
    sessions: rows.map(rowToJson),
    meta: { ttlSeconds: PRESENCE_TTL_SECONDS },
  });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return jsonError(405, 'Method not allowed');
};
