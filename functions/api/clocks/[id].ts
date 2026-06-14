/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { writeAuditLog } from '../../_lib/audit-log';
import {
  buildClockDelete,
  buildClockDetailQuery,
  buildClockUpdate,
} from '../../_lib/clock-queries';
import { requireStation } from '../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request; params: { id: string } };

export interface ClockDetailRow {
  clock_id: string;
  clock_station_id: string;
  clock_name: string;
  clock_color: string | null;
  clock_target_duration_ms: number | null;
  clock_created_at: string;
  slot_id: string | null;
  slot_position: number | null;
  slot_type: string | null;
  slot_category_id: string | null;
  slot_duration_estimate_ms: number | null;
  slot_rules_json: string | null;
}

interface ClockJson {
  id: string;
  stationId: string;
  name: string;
  color: string;
  targetDurationMs: number;
  createdAt: string;
  slots: SlotJson[];
}

interface SlotJson {
  id: string;
  position: number;
  slot_type: string;
  categoryId: string | null;
  durationEstimateMs: number;
  rulesJson: string | null;
}

function fetchClockDetail(
  db: D1Database,
  stationId: string,
  clockId: string,
): Promise<ClockJson | null> {
  const { sql, params } = buildClockDetailQuery(stationId, clockId);
  return db
    .prepare(sql)
    .bind(...params)
    .all<ClockDetailRow>()
    .then(({ results }) => groupClockDetailRows(results ?? []));
}

export function groupClockDetailRows(rows: ClockDetailRow[]): ClockJson | null {
  if (rows.length === 0) return null;
  const head = rows[0];
  const slots: SlotJson[] = [];
  for (const r of rows) {
    if (r.slot_id !== null && r.slot_position !== null && r.slot_type !== null) {
      slots.push({
        id: r.slot_id,
        position: r.slot_position,
        slot_type: r.slot_type,
        categoryId: r.slot_category_id,
        durationEstimateMs: r.slot_duration_estimate_ms ?? 0,
        rulesJson: r.slot_rules_json,
      });
    }
  }
  return {
    id: head.clock_id,
    stationId: head.clock_station_id,
    name: head.clock_name,
    color: head.clock_color ?? '#3b82f6',
    targetDurationMs: head.clock_target_duration_ms ?? 3600000,
    createdAt: head.clock_created_at,
    slots,
  };
}

const clockUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
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
  const id = ctx.params?.id;
  if (!id) return jsonError(404, 'Not found');
  const db = ctx.env.DB!;
  try {
    const clock = await fetchClockDetail(db, gate.context.stationId, id);
    if (!clock) return jsonError(404, 'Not found');
    return Response.json({ clock });
  } catch (err) {
    console.error('clocks/detail', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

export async function onRequestPatch(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const id = ctx.params?.id;
  if (!id) return jsonError(404, 'Not found');
  const db = ctx.env.DB!;

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = clockUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }
  if (
    parsed.data.name === undefined &&
    parsed.data.color === undefined &&
    parsed.data.targetDurationMs === undefined
  ) {
    return jsonError(400, 'Empty patch');
  }

  const before = await fetchClockDetail(db, gate.context.stationId, id);
  if (!before) return jsonError(404, 'Not found');

  try {
    const upd = buildClockUpdate({
      stationId: gate.context.stationId,
      clockId: id,
      name: parsed.data.name,
      color: parsed.data.color,
      targetDurationMs: parsed.data.targetDurationMs,
    });
    await db
      .prepare(upd.sql)
      .bind(...upd.params)
      .run();
  } catch (err) {
    console.error('clocks/patch', err);
    return jsonError(500, err instanceof Error ? err.message : 'update failed');
  }

  const after = await fetchClockDetail(db, gate.context.stationId, id);

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'update',
    targetType: 'clock',
    targetId: id,
    before: { name: before.name, color: before.color, targetDurationMs: before.targetDurationMs },
    after: after
      ? { name: after.name, color: after.color, targetDurationMs: after.targetDurationMs }
      : null,
  });

  return Response.json({ clock: after });
}

export async function onRequestDelete(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const id = ctx.params?.id;
  if (!id) return jsonError(404, 'Not found');
  const db = ctx.env.DB!;

  const before = await fetchClockDetail(db, gate.context.stationId, id);
  if (!before) return jsonError(404, 'Not found');

  try {
    const del = buildClockDelete(gate.context.stationId, id);
    await db
      .prepare(del.sql)
      .bind(...del.params)
      .run();
  } catch (err) {
    console.error('clocks/delete', err);
    return jsonError(500, err instanceof Error ? err.message : 'delete failed');
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'delete',
    targetType: 'clock',
    targetId: id,
    before: { name: before.name, color: before.color, targetDurationMs: before.targetDurationMs },
  });

  return new Response(null, { status: 204 });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  if (ctx.request.method === 'PATCH') return onRequestPatch(ctx);
  if (ctx.request.method === 'DELETE') return onRequestDelete(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
