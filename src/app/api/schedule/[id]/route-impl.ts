/**
 * /api/schedule/[id] — single schedule assignment lookup, patch, delete.
 *
 * Mirrors `functions/api/schedule/[id].ts`. Station ownership is verified
 * BEFORE the overlap check on PATCH so a cross-station target cannot leak
 * its `(weekday, hour)` cell via 409 vs 404 timing.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β4.
 */

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
  getScheduleById,
  updateScheduleAssignment,
  validateHour,
  validateWeekday,
  type ScheduleAssignmentPatch,
  type ScheduleRow,
} from '@/server/schedule-queries';

interface HandlerDeps {
  db?: DbClient;
  secret?: string;
}

interface RouteCtx {
  params: Promise<{ id: string }>;
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

export async function getScheduleByIdRoute(
  request: Request,
  id: string,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  if (!id) return jsonError(404, 'Not found');
  const db = deps.db ?? getDb();

  try {
    const row = await getScheduleById(db, gate.context.stationId, id);
    if (!row) return jsonError(404, 'Not found');
    return jsonOk({ assignment: rowToJson(row), source: 'd1' });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'schedule/[id]/get' }));
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

export async function patchScheduleById(
  request: Request,
  id: string,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // H-06: only admin + programmer may update schedule assignments.
  const forbidden = requireRole(gate.context, MUTATE_SCHEDULE_ROLES);
  if (forbidden) return forbidden;

  if (!id) return jsonError(404, 'Not found');
  const db = deps.db ?? getDb();

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  if (!body || typeof body !== 'object') {
    return jsonError(400, 'Invalid body');
  }

  const existing = await getScheduleById(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');
  const existingJson = rowToJson(existing);

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
      return jsonError(
        400,
        err instanceof Error ? err.message : 'Invalid weekday',
      );
    }
    patch.weekday = body.weekday as number;
  }
  if (body.hour !== undefined) {
    try {
      validateHour(body.hour);
    } catch (err) {
      return jsonError(
        400,
        err instanceof Error ? err.message : 'Invalid hour',
      );
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
      if (!result.ok) {
        return jsonError(400, `Invalid rrule: ${result.error}`);
      }
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

  // H-07: if clockId is being changed, verify the new clock belongs to the
  // caller's station. An attacker from Station A must not attach Station B's
  // clock via a PATCH request.
  if (patch.clockId !== undefined) {
    const clockOk = await db
      .select({ id: clocks.id })
      .from(clocks)
      .where(and(eq(clocks.id, patch.clockId), eq(clocks.stationId, gate.context.stationId)))
      .limit(1);
    if (clockOk.length === 0) {
      return jsonError(400, 'Clock not found in this station');
    }
  }

  const finalWeekday = patch.weekday ?? existing.weekday;
  const finalHour = patch.hour ?? existing.hour;
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';

  let conflicts: ScheduleJson[] = [];
  if (patch.weekday !== undefined || patch.hour !== undefined) {
    try {
      const conflictRows = await findOverlappingAssignments(
        db,
        gate.context.stationId,
        finalWeekday,
        finalHour,
        existing.id,
      );
      conflicts = conflictRows.map(rowToJson);
    } catch (err) {
      return jsonError(500, logAndScrub(err, { tag: 'schedule/[id]/overlap-check' }));
    }
    // Legacy 409 shape: `{ error: 'overlap', conflicts: [...] }`.
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
  }

  try {
    await updateScheduleAssignment(db, gate.context.stationId, id, patch);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'schedule/[id]/patch' }));
  }

  const updated = await getScheduleById(db, gate.context.stationId, id);
  if (!updated) {
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

  return jsonOk({
    assignment: updatedJson,
    overrode: conflicts,
  });
}

export async function deleteScheduleById(
  request: Request,
  id: string,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // H-06: only admin + programmer may delete schedule assignments.
  const forbidden = requireRole(gate.context, MUTATE_SCHEDULE_ROLES);
  if (forbidden) return forbidden;

  if (!id) return jsonError(404, 'Not found');
  const db = deps.db ?? getDb();

  const existing = await getScheduleById(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');
  const beforeJson = rowToJson(existing);

  try {
    await deleteScheduleAssignment(db, gate.context.stationId, id);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'schedule/[id]/delete' }));
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'delete',
    targetType: 'schedule_assignment',
    targetId: id,
    before: beforeJson,
  });

  return jsonOk({ ok: true, deleted: beforeJson });
}

export async function GET(
  request: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;
  return getScheduleByIdRoute(request, id);
}

export async function PATCH(
  request: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;
  return patchScheduleById(request, id);
}

export async function DELETE(
  request: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;
  return deleteScheduleById(request, id);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['GET', 'PATCH', 'DELETE']);
}
