/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../../_lib/env';
import { writeAuditLog } from '../../../_lib/audit-log';
import {
  buildClockDetailQuery,
  buildSlotInsert,
  buildSlotsReorder,
  SLOT_TYPES,
} from '../../../_lib/clock-queries';
import { requireStation } from '../../../_lib/require-station';
import { groupClockDetailRows, type ClockDetailRow } from '../[id]';

type Ctx = { env: SonicBloomEnv; request: Request; params: { id: string } };

const slotTypeSchema = z.enum([...SLOT_TYPES]);

const slotCreateSchema = z.object({
  position: z.number().int().nonnegative(),
  slotType: slotTypeSchema,
  categoryId: z.string().trim().min(1).max(64).nullable().optional(),
  durationEstimateMs: z.number().int().nonnegative().max(86_400_000),
  rulesJson: z.string().max(8192).nullable().optional(),
});

const reorderSchema = z.object({
  order: z
    .array(
      z.object({
        id: z.string().min(1),
        position: z.number().int().nonnegative(),
      }),
    )
    .min(1),
});

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function loadStationClock(
  db: D1Database,
  stationId: string,
  clockId: string,
): Promise<ReturnType<typeof groupClockDetailRows>> {
  const { sql, params } = buildClockDetailQuery(stationId, clockId);
  const { results } = await db
    .prepare(sql)
    .bind(...params)
    .all<ClockDetailRow>();
  return groupClockDetailRows(results ?? []);
}

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const clockId = ctx.params?.id;
  if (!clockId) return jsonError(404, 'Not found');
  const db = ctx.env.DB!;

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = slotCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  // Verify clock exists and belongs to caller's station.
  const owned = await loadStationClock(db, gate.context.stationId, clockId);
  if (!owned) return jsonError(404, 'Not found');

  const slotId = crypto.randomUUID();
  const insert = buildSlotInsert({
    id: slotId,
    clockId,
    position: parsed.data.position,
    slotType: parsed.data.slotType,
    categoryId: parsed.data.categoryId ?? null,
    durationEstimateMs: parsed.data.durationEstimateMs,
    rulesJson: parsed.data.rulesJson ?? null,
  });

  try {
    await db
      .prepare(insert.sql)
      .bind(...insert.params)
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE/i.test(msg)) {
      return jsonError(409, 'Slot position already in use');
    }
    console.error('clocks/slots/post', err);
    return jsonError(500, msg);
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'create',
    targetType: 'clock_slot',
    targetId: slotId,
    after: {
      id: slotId,
      clockId,
      position: parsed.data.position,
      slotType: parsed.data.slotType,
      categoryId: parsed.data.categoryId ?? null,
      durationEstimateMs: parsed.data.durationEstimateMs,
    },
  });

  return new Response(
    JSON.stringify({
      slot: {
        id: slotId,
        clockId,
        position: parsed.data.position,
        slotType: parsed.data.slotType,
        categoryId: parsed.data.categoryId ?? null,
        durationEstimateMs: parsed.data.durationEstimateMs,
        rulesJson: parsed.data.rulesJson ?? null,
      },
    }),
    { status: 201, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
}

/**
 * Reorder slots within a clock. Body: { order: [{ id, position }, ...] }.
 *
 * The UNIQUE(clock_id, position) constraint forbids two rows at the same
 * position simultaneously. We dodge that by parking every reordered slot
 * at `position + 10_000`, then landing each one at its final position in
 * the same batch (the batch runs as a transaction).
 */
export async function onRequestPut(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const clockId = ctx.params?.id;
  if (!clockId) return jsonError(404, 'Not found');
  const db = ctx.env.DB!;

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = reorderSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const owned = await loadStationClock(db, gate.context.stationId, clockId);
  if (!owned) return jsonError(404, 'Not found');

  const PARK_OFFSET = 10_000;
  const parkOrder = parsed.data.order.map((o) => ({ id: o.id, position: o.position + PARK_OFFSET }));
  const landOrder = parsed.data.order.map((o) => ({ id: o.id, position: o.position }));
  const park = buildSlotsReorder(clockId, parkOrder);
  const land = buildSlotsReorder(clockId, landOrder);
  const stmts = [...park, ...land].map((q) =>
    db.prepare(q.sql).bind(...q.params),
  );

  try {
    await db.batch(stmts);
  } catch (err) {
    console.error('clocks/slots/put', err);
    return jsonError(500, err instanceof Error ? err.message : 'reorder failed');
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'reorder',
    targetType: 'clock_slot',
    targetId: clockId,
    before: { order: owned.slots.map((s) => ({ id: s.id, position: s.position })) },
    after: { order: parsed.data.order },
  });

  return Response.json({ ok: true, order: parsed.data.order });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  if (ctx.request.method === 'PUT') return onRequestPut(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
