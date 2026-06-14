/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { writeAuditLog } from '../../_lib/audit-log';
import { validateRRule } from '../../_lib/rrule-validation';
import {
  buildScheduleByIdQuery,
  buildScheduleAssignmentUpdate,
  buildScheduleAssignmentDelete,
  buildFindOverlappingAssignments,
  validateWeekday,
  validateHour,
  type ScheduleAssignmentPatch,
} from '../../_lib/schedule-queries';

type Ctx = { env: SonicBloomEnv; request: Request; params: { id: string } };

interface ScheduleRow {
  id: string;
  station_id: string;
  clock_id: string;
  weekday: number;
  hour: number;
  valid_from: string | null;
  valid_until: string | null;
  rrule: string | null;
  created_at: string;
}

interface ScheduleJson {
  id: string;
  stationId: string;
  clockId: string;
  weekday: number;
  hour: number;
  validFrom: string | null;
  validUntil: string | null;
  rrule: string | null;
  createdAt: string;
}

function rowToJson(row: ScheduleRow): ScheduleJson {
  return {
    id: row.id,
    stationId: row.station_id,
    clockId: row.clock_id,
    weekday: row.weekday,
    hour: row.hour,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    rrule: row.rrule,
    createdAt: row.created_at,
  };
}

function jsonError(status: number, message: string, extra?: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error: message, ...(extra ?? {}) }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function loadAssignment(
  db: D1Database,
  stationId: string,
  id: string,
): Promise<ScheduleRow | null> {
  const q = buildScheduleByIdQuery(stationId, id);
  const row = await db.prepare(q.sql).bind(...q.params).first<ScheduleRow>();
  return row ?? null;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const id = ctx.params?.id;
  if (!id) return jsonError(404, 'Not found');

  try {
    const row = await loadAssignment(db, gate.context.stationId, id);
    if (!row) return jsonError(404, 'Not found');
    return Response.json({ assignment: rowToJson(row), source: 'd1' });
  } catch (err) {
    console.error('schedule get', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

interface UpdateBody {
  clockId?: unknown;
  weekday?: unknown;
  hour?: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  rrule?: unknown;
}

export async function onRequestPatch(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const id = ctx.params?.id;
  if (!id) return jsonError(404, 'Not found');

  let body: UpdateBody;
  try {
    body = (await ctx.request.json()) as UpdateBody;
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object') return jsonError(400, 'Invalid body');

  // Verify the row exists and belongs to this station BEFORE we run any
  // overlap checks. Without this, a cross-station target would leak its
  // (weekday, hour) cell via 409 vs 404 timing.
  const existing = await loadAssignment(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');
  const existingJson = rowToJson(existing);

  // Build the patch with strict per-field validation.
  const patch: ScheduleAssignmentPatch = {};

  if (body.clockId !== undefined) {
    if (typeof body.clockId !== 'string' || !body.clockId.trim()) {
      return jsonError(400, 'clockId must be a non-empty string');
    }
    patch.clockId = body.clockId.trim();
  }
  if (body.weekday !== undefined) {
    try {
      validateWeekday(body.weekday);
    } catch (err) {
      return jsonError(400, err instanceof Error ? err.message : 'Invalid weekday');
    }
    patch.weekday = body.weekday as number;
  }
  if (body.hour !== undefined) {
    try {
      validateHour(body.hour);
    } catch (err) {
      return jsonError(400, err instanceof Error ? err.message : 'Invalid hour');
    }
    patch.hour = body.hour as number;
  }
  if (body.validFrom !== undefined) {
    if (body.validFrom !== null && typeof body.validFrom !== 'string') {
      return jsonError(400, 'validFrom must be a string or null');
    }
    patch.validFrom = body.validFrom as string | null;
  }
  if (body.validUntil !== undefined) {
    if (body.validUntil !== null && typeof body.validUntil !== 'string') {
      return jsonError(400, 'validUntil must be a string or null');
    }
    patch.validUntil = body.validUntil as string | null;
  }
  if (body.rrule !== undefined) {
    if (body.rrule === null || body.rrule === '') {
      patch.rrule = null;
    } else if (typeof body.rrule !== 'string') {
      return jsonError(400, 'rrule must be a string or null');
    } else {
      const result = validateRRule(body.rrule);
      if (!result.ok) return jsonError(400, `Invalid rrule: ${result.error}`);
      patch.rrule = result.normalized ?? null;
    }
  }

  if (
    patch.clockId === undefined &&
    patch.weekday === undefined &&
    patch.hour === undefined &&
    patch.validFrom === undefined &&
    patch.validUntil === undefined &&
    patch.rrule === undefined
  ) {
    return jsonError(400, 'no fields to update');
  }

  // Conflict detection if weekday or hour is changing. Use the resulting cell
  // coordinates (incoming patch value, or fall back to the existing row).
  const finalWeekday = patch.weekday ?? existing.weekday;
  const finalHour = patch.hour ?? existing.hour;
  const url = new URL(ctx.request.url);
  const force = url.searchParams.get('force') === '1';

  let conflicts: ScheduleJson[] = [];
  if (patch.weekday !== undefined || patch.hour !== undefined) {
    try {
      const overlapQ = buildFindOverlappingAssignments(
        gate.context.stationId,
        finalWeekday,
        finalHour,
        existing.id,
      );
      const { results } = await db
        .prepare(overlapQ.sql)
        .bind(...overlapQ.params)
        .all<ScheduleRow>();
      conflicts = (results ?? []).map(rowToJson);
    } catch (err) {
      console.error('schedule patch overlap check', err);
      return jsonError(500, err instanceof Error ? err.message : 'overlap check failed');
    }
    if (conflicts.length > 0 && !force) {
      return jsonError(409, 'overlap', { conflicts });
    }
    if (conflicts.length > 0 && force) {
      for (const c of conflicts) {
        try {
          const del = buildScheduleAssignmentDelete(gate.context.stationId, c.id);
          await db.prepare(del.sql).bind(...del.params).run();
          await writeAuditLog(db, {
            stationId: gate.context.stationId,
            actorUserId: gate.context.userId,
            action: 'delete',
            targetType: 'schedule_assignment',
            targetId: c.id,
            before: c,
          });
        } catch (err) {
          console.error('schedule override delete (patch)', err);
          return jsonError(500, 'override delete failed');
        }
      }
    }
  }

  let updateQ: ReturnType<typeof buildScheduleAssignmentUpdate>;
  try {
    updateQ = buildScheduleAssignmentUpdate(gate.context.stationId, id, patch);
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid patch');
  }

  try {
    await db.prepare(updateQ.sql).bind(...updateQ.params).run();
  } catch (err) {
    console.error('schedule update', err);
    return jsonError(500, err instanceof Error ? err.message : 'update failed');
  }

  const updated = await loadAssignment(db, gate.context.stationId, id);
  if (!updated) {
    // Extremely defensive — would only fire if a concurrent delete raced us.
    return jsonError(404, 'Not found after update');
  }
  const updatedJson = rowToJson(updated);

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'update',
    targetType: 'schedule_assignment',
    targetId: id,
    before: existingJson,
    after: updatedJson,
  });

  return Response.json({
    assignment: updatedJson,
    overrode: conflicts,
  });
}

export async function onRequestDelete(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const id = ctx.params?.id;
  if (!id) return jsonError(404, 'Not found');

  // Load BEFORE delete so we can record the before-snapshot in audit_log.
  const existing = await loadAssignment(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');
  const beforeJson = rowToJson(existing);

  try {
    const del = buildScheduleAssignmentDelete(gate.context.stationId, id);
    await db.prepare(del.sql).bind(...del.params).run();
  } catch (err) {
    console.error('schedule delete', err);
    return jsonError(500, err instanceof Error ? err.message : 'delete failed');
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'delete',
    targetType: 'schedule_assignment',
    targetId: id,
    before: beforeJson,
  });

  return Response.json({ ok: true, deleted: beforeJson });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  if (ctx.request.method === 'PATCH') return onRequestPatch(ctx);
  if (ctx.request.method === 'DELETE') return onRequestDelete(ctx);
  return jsonError(405, 'Method not allowed');
};
