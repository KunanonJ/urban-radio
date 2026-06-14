/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { writeAuditLog } from '../../_lib/audit-log';
import { buildClockInsert, buildClocksListQuery } from '../../_lib/clock-queries';
import { requireStation } from '../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

interface ClockRow {
  id: string;
  station_id: string;
  name: string;
  color: string | null;
  target_duration_ms: number | null;
  created_at: string;
}

function clockRowToJson(row: ClockRow): Record<string, unknown> {
  return {
    id: row.id,
    stationId: row.station_id,
    name: row.name,
    color: row.color ?? '#3b82f6',
    targetDurationMs: row.target_duration_ms ?? 3600000,
    createdAt: row.created_at,
  };
}

const clockCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a #RRGGBB hex')
    .optional(),
  targetDurationMs: z.number().int().nonnegative().max(86_400_000).optional(),
});

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;
  try {
    const { sql, params } = buildClocksListQuery(gate.context.stationId);
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<ClockRow>();
    return Response.json({
      clocks: (results ?? []).map(clockRowToJson),
      meta: { limit: results?.length ?? 0 },
    });
  } catch (err) {
    console.error('clocks/list', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

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
  const parsed = clockCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const id = crypto.randomUUID();
  const insert = buildClockInsert({
    id,
    stationId: gate.context.stationId,
    name: parsed.data.name,
    color: parsed.data.color,
    targetDurationMs: parsed.data.targetDurationMs,
  });

  try {
    await db
      .prepare(insert.sql)
      .bind(...insert.params)
      .run();
  } catch (err) {
    console.error('clocks/create', err);
    return jsonError(500, err instanceof Error ? err.message : 'insert failed');
  }

  const after = {
    id,
    name: parsed.data.name,
    color: parsed.data.color ?? '#3b82f6',
    targetDurationMs: parsed.data.targetDurationMs ?? 3600000,
  };

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'create',
    targetType: 'clock',
    targetId: id,
    after,
  });

  return new Response(
    JSON.stringify({
      clock: {
        id,
        stationId: gate.context.stationId,
        name: parsed.data.name,
        color: parsed.data.color ?? '#3b82f6',
        targetDurationMs: parsed.data.targetDurationMs ?? 3600000,
      },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  );
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
