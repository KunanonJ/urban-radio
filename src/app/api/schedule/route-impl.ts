/**
 * /api/schedule — list + create weekly schedule assignments.
 *
 * Mirrors `functions/api/schedule/index.ts`. D7 override semantics:
 *   - POST with no `?force=1` and an existing assignment in the same
 *     (weekday, hour) cell returns 409 with `{ conflicts: [...] }`
 *   - POST with `?force=1` deletes the conflicts (one audit row each)
 *     and inserts the new assignment in one atomic flow.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β4.
 */

import { randomUUID } from 'node:crypto';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { requireRole, MUTATE_SCHEDULE_ROLES } from '@/server/auth/require-role';
import { writeAuditLog } from '@/server/audit-log';
import { logAndScrub } from '@/server/internal-error';
import { validateRRule } from '@/server/rrule-validation';
import { clocks } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import {
  deleteScheduleAssignment,
  findOverlappingAssignments,
  insertScheduleAssignment,
  listSchedule,
  validateHour,
  validateWeekday,
  type ScheduleRow,
} from '@/server/schedule-queries';

interface HandlerDeps {
  db?: DbClient;
  secret?: string;
  newId?: () => string;
  /** Override the "now" used as `created_at`. Tests freeze this. */
  now?: () => Date;
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
    stationId: row.stationId,
    clockId: row.clockId,
    weekday: row.weekday,
    hour: row.hour,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    rrule: row.rrule,
    createdAt: row.createdAt,
  };
}

function parseIntFromQuery(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
  return n;
}

export async function getSchedule(
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  const url = new URL(request.url);
  const weekday = parseIntFromQuery(url.searchParams.get('weekday'));
  const hour = parseIntFromQuery(url.searchParams.get('hour'));

  try {
    if (weekday !== undefined) validateWeekday(weekday);
    if (hour !== undefined) validateHour(hour);
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid filter');
  }

  try {
    const rows = await listSchedule(db, gate.context.stationId, {
      weekday,
      hour,
    });
    return jsonOk({
      assignments: rows.map(rowToJson),
      source: 'd1',
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'schedule/list' }));
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

export async function postSchedule(
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // H-06: only admin + programmer may create schedule assignments.
  const forbidden = requireRole(gate.context, MUTATE_SCHEDULE_ROLES);
  if (forbidden) return forbidden;

  const db = deps.db ?? getDb();

  let body: CreateScheduleBody;
  try {
    body = (await request.json()) as CreateScheduleBody;
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object') {
    return jsonError(400, 'Invalid body');
  }

  const clockId = typeof body.clockId === 'string' ? body.clockId.trim() : '';
  if (!clockId) return jsonError(400, 'clockId is required');

  try {
    validateWeekday(body.weekday);
    validateHour(body.hour);
  } catch (err) {
    return jsonError(
      400,
      err instanceof Error ? err.message : 'Invalid weekday/hour',
    );
  }

  let normalizedRRule: string | null = null;
  if (body.rrule !== undefined && body.rrule !== null && body.rrule !== '') {
    if (typeof body.rrule !== 'string') {
      return jsonError(400, 'rrule must be a string');
    }
    const result = validateRRule(body.rrule);
    if (!result.ok) {
      return jsonError(400, `Invalid rrule: ${result.error}`);
    }
    normalizedRRule = result.normalized ?? null;
  }

  // H-07: verify clockId belongs to the caller's station before inserting.
  // An operator from Station A must not attach Station B's clock.
  const clockOk = await db
    .select({ id: clocks.id })
    .from(clocks)
    .where(and(eq(clocks.id, clockId), eq(clocks.stationId, gate.context.stationId)))
    .limit(1);
  if (clockOk.length === 0) {
    return jsonError(400, 'Clock not found in this station');
  }

  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';

  const weekday = body.weekday as number;
  const hour = body.hour as number;

  let conflicts: ScheduleJson[] = [];
  try {
    const conflictRows = await findOverlappingAssignments(
      db,
      gate.context.stationId,
      weekday,
      hour,
    );
    conflicts = conflictRows.map(rowToJson);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'schedule/overlap-check' }));
  }

  // The legacy Cloudflare jsonError merges `extra` into the body, producing
  // `{ error: 'overlap', conflicts: [...] }`. The shared Next helper wraps
  // `details` instead — emit the legacy shape directly so clients don't fork.
  if (conflicts.length > 0 && !force) {
    return new Response(
      JSON.stringify({ error: 'overlap', conflicts }),
      {
        status: 409,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  if (conflicts.length > 0 && force) {
    for (const c of conflicts) {
      try {
        await deleteScheduleAssignment(db, gate.context.stationId, c.id);
        await writeAuditLog(db, {
          stationId: gate.context.stationId,
          actorUserId: gate.context.userId,
          action: 'delete',
          targetType: 'schedule_assignment',
          targetId: c.id,
          before: c,
        });
      } catch {
        return jsonError(500, 'override delete failed');
      }
    }
  }

  const id = (deps.newId ?? randomUUID)();
  const createdAt = (deps.now ?? (() => new Date()))().toISOString();
  try {
    await insertScheduleAssignment(
      db,
      {
        id,
        stationId: gate.context.stationId,
        clockId,
        weekday,
        hour,
        validFrom: typeof body.validFrom === 'string' ? body.validFrom : null,
        validUntil:
          typeof body.validUntil === 'string' ? body.validUntil : null,
        rrule: normalizedRRule,
      },
      createdAt,
    );
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'schedule/insert' }));
  }

  const persisted: ScheduleJson = {
    id,
    stationId: gate.context.stationId,
    clockId,
    weekday,
    hour,
    validFrom: typeof body.validFrom === 'string' ? body.validFrom : null,
    validUntil: typeof body.validUntil === 'string' ? body.validUntil : null,
    rrule: normalizedRRule,
    createdAt,
  };

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'create',
    targetType: 'schedule_assignment',
    targetId: id,
    after: persisted,
  });

  return jsonOk(
    { assignment: persisted, overrode: conflicts },
    { status: 201 },
  );
}

export async function GET(request: Request): Promise<Response> {
  return getSchedule(request);
}

export async function POST(request: Request): Promise<Response> {
  return postSchedule(request);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['GET', 'POST']);
}
