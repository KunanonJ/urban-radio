/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { writeAuditLog } from '../../_lib/audit-log';
import { validateRRule } from '../../_lib/rrule-validation';
import {
  buildScheduleListQuery,
  buildScheduleAssignmentInsert,
  buildScheduleAssignmentDelete,
  buildFindOverlappingAssignments,
  validateWeekday,
  validateHour,
  type ScheduleAssignment,
} from '../../_lib/schedule-queries';

type Ctx = { env: SonicBloomEnv; request: Request };

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

function parseIntFromQuery(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  return n;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
  const weekday = parseIntFromQuery(url.searchParams.get('weekday'));
  const hour = parseIntFromQuery(url.searchParams.get('hour'));

  // Validate the filter inputs before calling the builder so we return a
  // friendly 400 rather than 500 on bad input.
  try {
    if (weekday !== undefined) validateWeekday(weekday);
    if (hour !== undefined) validateHour(hour);
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid filter');
  }

  let query: ReturnType<typeof buildScheduleListQuery>;
  try {
    query = buildScheduleListQuery(gate.context.stationId, { weekday, hour });
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid query');
  }

  try {
    const { results } = await db
      .prepare(query.sql)
      .bind(...query.params)
      .all<ScheduleRow>();
    const assignments = (results ?? []).map(rowToJson);
    return Response.json({ assignments, source: 'd1' });
  } catch (err) {
    console.error('schedule list', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

interface CreateScheduleBody {
  clockId?: unknown;
  weekday?: unknown;
  hour?: unknown;
  validFrom?: unknown;
  validUntil?: unknown;
  rrule?: unknown;
}

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  let body: CreateScheduleBody;
  try {
    body = (await ctx.request.json()) as CreateScheduleBody;
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object') return jsonError(400, 'Invalid body');

  const clockId = typeof body.clockId === 'string' ? body.clockId.trim() : '';
  if (!clockId) return jsonError(400, 'clockId is required');

  // Validate weekday/hour up-front for a clean 400 error message.
  try {
    validateWeekday(body.weekday);
    validateHour(body.hour);
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid weekday/hour');
  }

  // Validate optional rrule server-side. Empty / null means "no rule".
  let normalizedRRule: string | null = null;
  if (body.rrule !== undefined && body.rrule !== null && body.rrule !== '') {
    if (typeof body.rrule !== 'string') return jsonError(400, 'rrule must be a string');
    const result = validateRRule(body.rrule);
    if (!result.ok) return jsonError(400, `Invalid rrule: ${result.error}`);
    normalizedRRule = result.normalized ?? null;
  }

  // Conflict detection — D7 override semantics.
  const url = new URL(ctx.request.url);
  const force = url.searchParams.get('force') === '1';

  const weekday = body.weekday as number;
  const hour = body.hour as number;

  let conflicts: ScheduleJson[] = [];
  try {
    const overlapQ = buildFindOverlappingAssignments(
      gate.context.stationId,
      weekday,
      hour,
    );
    const { results } = await db
      .prepare(overlapQ.sql)
      .bind(...overlapQ.params)
      .all<ScheduleRow>();
    conflicts = (results ?? []).map(rowToJson);
  } catch (err) {
    console.error('schedule overlap check', err);
    return jsonError(500, err instanceof Error ? err.message : 'overlap check failed');
  }

  if (conflicts.length > 0 && !force) {
    return jsonError(409, 'overlap', { conflicts });
  }

  // If we're overriding, delete the conflicting rows first. We do this before
  // the new INSERT so we never end up with two assignments in one cell.
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
        console.error('schedule override delete', err);
        return jsonError(500, 'override delete failed');
      }
    }
  }

  const id = crypto.randomUUID();
  const assignment: ScheduleAssignment = {
    id,
    stationId: gate.context.stationId,
    clockId,
    weekday,
    hour,
    validFrom: typeof body.validFrom === 'string' ? body.validFrom : null,
    validUntil: typeof body.validUntil === 'string' ? body.validUntil : null,
    rrule: normalizedRRule,
  };

  let insert: ReturnType<typeof buildScheduleAssignmentInsert>;
  try {
    insert = buildScheduleAssignmentInsert(assignment);
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid assignment');
  }

  try {
    await db.prepare(insert.sql).bind(...insert.params).run();
  } catch (err) {
    console.error('schedule insert', err);
    return jsonError(500, err instanceof Error ? err.message : 'insert failed');
  }

  const persisted: ScheduleJson = {
    id,
    stationId: gate.context.stationId,
    clockId,
    weekday,
    hour,
    validFrom: assignment.validFrom ?? null,
    validUntil: assignment.validUntil ?? null,
    rrule: normalizedRRule,
    // The server fills in `created_at` via `datetime('now')`; we mirror the
    // current time client-side so the response is well-formed even though we
    // didn't round-trip a SELECT.
    createdAt: new Date().toISOString(),
  };

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'create',
    targetType: 'schedule_assignment',
    targetId: id,
    after: persisted,
  });

  return new Response(
    JSON.stringify({
      assignment: persisted,
      overrode: conflicts,
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
  return jsonError(405, 'Method not allowed');
};
