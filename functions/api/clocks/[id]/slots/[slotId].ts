/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../../../_lib/env';
import { writeAuditLog } from '../../../../_lib/audit-log';
import {
  buildClockDetailQuery,
  buildSlotDelete,
  buildSlotUpdate,
  SLOT_TYPES,
} from '../../../../_lib/clock-queries';
import { requireStation } from '../../../../_lib/require-station';
import { groupClockDetailRows, type ClockDetailRow } from '../../[id]';

type Ctx = {
  env: SonicBloomEnv;
  request: Request;
  params: { id: string; slotId: string };
};

const slotTypeSchema = z.enum([...SLOT_TYPES]);

const slotUpdateSchema = z.object({
  position: z.number().int().nonnegative().optional(),
  slotType: slotTypeSchema.optional(),
  categoryId: z.string().trim().min(1).max(64).nullable().optional(),
  durationEstimateMs: z.number().int().nonnegative().max(86_400_000).optional(),
  rulesJson: z.string().max(8192).nullable().optional(),
});

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function loadStationClock(db: D1Database, stationId: string, clockId: string) {
  const { sql, params } = buildClockDetailQuery(stationId, clockId);
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<ClockDetailRow>();
  return groupClockDetailRows(results ?? []);
}

export async function onRequestPatch(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const clockId = ctx.params?.id;
  const slotId = ctx.params?.slotId;
  if (!clockId || !slotId) return jsonError(404, 'Not found');
  const db = ctx.env.DB!;

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = slotUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }
  // Reject empty patches early so the SQL builder doesn't have to.
  if (
    parsed.data.position === undefined &&
    parsed.data.slotType === undefined &&
    parsed.data.categoryId === undefined &&
    parsed.data.durationEstimateMs === undefined &&
    parsed.data.rulesJson === undefined
  ) {
    return jsonError(400, 'Empty patch');
  }

  // Station ownership: re-verify by loading clock detail; reject if the
  // requested slot isn't in this clock.
  const owned = await loadStationClock(db, gate.context.stationId, clockId);
  if (!owned) return jsonError(404, 'Not found');
  const before = owned.slots.find((s) => s.id === slotId);
  if (!before) return jsonError(404, 'Not found');

  try {
    const upd = buildSlotUpdate({
      clockId,
      slotId,
      position: parsed.data.position,
      slotType: parsed.data.slotType,
      categoryId: parsed.data.categoryId,
      durationEstimateMs: parsed.data.durationEstimateMs,
      rulesJson: parsed.data.rulesJson,
    });
    await db
      .prepare(upd.sql)
      .bind(...upd.params)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(msg)) {
      return jsonError(409, 'Slot position already in use');
    }
    console.error('clocks/slots/[slotId]/patch', err);
    return jsonError(500, msg);
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'update',
    targetType: 'clock_slot',
    targetId: slotId,
    before: {
      position: before.position,
      slotType: before.slot_type,
      categoryId: before.categoryId,
      durationEstimateMs: before.durationEstimateMs,
      rulesJson: before.rulesJson,
    },
    after: {
      ...before,
      ...parsed.data,
    },
  });

  return Response.json({ ok: true });
}

export async function onRequestDelete(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const clockId = ctx.params?.id;
  const slotId = ctx.params?.slotId;
  if (!clockId || !slotId) return jsonError(404, 'Not found');
  const db = ctx.env.DB!;

  const owned = await loadStationClock(db, gate.context.stationId, clockId);
  if (!owned) return jsonError(404, 'Not found');
  const before = owned.slots.find((s) => s.id === slotId);
  if (!before) return jsonError(404, 'Not found');

  try {
    const del = buildSlotDelete(clockId, slotId);
    await db
      .prepare(del.sql)
      .bind(...del.params)
      .run();
  } catch (err) {
    console.error('clocks/slots/[slotId]/delete', err);
    return jsonError(500, err instanceof Error ? err.message : 'delete failed');
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'delete',
    targetType: 'clock_slot',
    targetId: slotId,
    before: {
      position: before.position,
      slotType: before.slot_type,
      categoryId: before.categoryId,
      durationEstimateMs: before.durationEstimateMs,
    },
  });

  return new Response(null, { status: 204 });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'PATCH') return onRequestPatch(ctx);
  if (ctx.request.method === 'DELETE') return onRequestDelete(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
