/// <reference types="@cloudflare/workers-types" />

/**
 * GET /api/presence?targetType=&targetId=
 *
 * Returns the list of active presence sessions for one polymorphic target.
 * Active means `last_heartbeat_at > now - 15s`. Station scope is enforced
 * by `requireStation` so cross-tenant probes are structurally impossible.
 *
 * Typically the client gets the same payload as a side-effect of
 * `POST /api/presence/heartbeat`. This GET endpoint is the read-only path
 * for components that want to observe a target without claiming presence
 * themselves.
 *
 * Deferred (Phase 6.2): real-time push via WebSocket / Durable Objects.
 */

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import {
  buildPresenceListActive,
  isPresenceTargetType,
  PRESENCE_TARGET_TYPES,
  PRESENCE_TTL_SECONDS,
  type PresenceTargetType,
} from '../../_lib/presence-queries';
import type { PresenceSessionJson } from './heartbeat';

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

const listQuerySchema = z.object({
  targetType: z.enum(
    PRESENCE_TARGET_TYPES as unknown as [PresenceTargetType, ...PresenceTargetType[]],
  ),
  targetId: z.string().trim().min(1).max(200),
});

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
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

  let listQ: ReturnType<typeof buildPresenceListActive>;
  try {
    listQ = buildPresenceListActive({
      stationId: gate.context.stationId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
    });
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid query');
  }

  try {
    const { results } = await db
      .prepare(listQ.sql)
      .bind(...listQ.params)
      .all<PresenceDbRow>();
    const rows = results ?? [];
    return Response.json({
      sessions: rows.map(rowToJson),
      meta: { ttlSeconds: PRESENCE_TTL_SECONDS },
    });
  } catch (err) {
    console.error('presence/list', err);
    return jsonError(500, err instanceof Error ? err.message : 'list failed');
  }
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return jsonError(405, 'Method not allowed');
};
