/**
 * /api/clocks/[id] — clock detail (with embedded slots), patch, delete.
 *
 * Mirrors `functions/api/clocks/[id].ts`. Slot list is returned as part of
 * the clock JSON to preserve the legacy single-fetch contract used by the UI.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β4.
 */

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { requireRole, MUTATE_CLOCKS_ROLES } from '@/server/auth/require-role';
import { writeAuditLog } from '@/server/audit-log';
import { logAndScrub } from '@/server/internal-error';
import {
  deleteClock,
  getClockDetail,
  updateClock,
} from '@/server/clock-queries';

interface HandlerDeps {
  db?: DbClient;
  secret?: string;
}

interface RouteCtx {
  params: Promise<{ id: string }>;
}

const clockUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a #RRGGBB hex')
    .optional(),
  targetDurationMs: z
    .number()
    .int()
    .nonnegative()
    .max(86_400_000)
    .optional(),
});

export async function getClock(
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
    const clock = await getClockDetail(db, gate.context.stationId, id);
    if (!clock) return jsonError(404, 'Not found');
    return jsonOk({ clock });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'clocks/[id]/get' }));
  }
}

export async function patchClock(
  request: Request,
  id: string,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // H-05: only admin + programmer may update clocks.
  const forbidden = requireRole(gate.context, MUTATE_CLOCKS_ROLES);
  if (forbidden) return forbidden;

  if (!id) return jsonError(404, 'Not found');
  const db = deps.db ?? getDb();

  let raw: unknown;
  try {
    raw = await request.json();
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

  const before = await getClockDetail(db, gate.context.stationId, id);
  if (!before) return jsonError(404, 'Not found');

  try {
    await updateClock(db, {
      stationId: gate.context.stationId,
      clockId: id,
      name: parsed.data.name,
      color: parsed.data.color,
      targetDurationMs: parsed.data.targetDurationMs,
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'clocks/[id]/patch' }));
  }

  const after = await getClockDetail(db, gate.context.stationId, id);

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'update',
    targetType: 'clock',
    targetId: id,
    before: {
      name: before.name,
      color: before.color,
      targetDurationMs: before.targetDurationMs,
    },
    after: after
      ? {
          name: after.name,
          color: after.color,
          targetDurationMs: after.targetDurationMs,
        }
      : null,
  });

  return jsonOk({ clock: after });
}

export async function deleteClockHandler(
  request: Request,
  id: string,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // H-05: only admin + programmer may delete clocks.
  const forbidden = requireRole(gate.context, MUTATE_CLOCKS_ROLES);
  if (forbidden) return forbidden;

  if (!id) return jsonError(404, 'Not found');
  const db = deps.db ?? getDb();

  const before = await getClockDetail(db, gate.context.stationId, id);
  if (!before) return jsonError(404, 'Not found');

  try {
    await deleteClock(db, gate.context.stationId, id);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'clocks/[id]/delete' }));
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'delete',
    targetType: 'clock',
    targetId: id,
    before: {
      name: before.name,
      color: before.color,
      targetDurationMs: before.targetDurationMs,
    },
  });

  return new Response(null, { status: 204 });
}

export async function GET(
  request: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;
  return getClock(request, id);
}

export async function PATCH(
  request: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;
  return patchClock(request, id);
}

export async function DELETE(
  request: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;
  return deleteClockHandler(request, id);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['GET', 'PATCH', 'DELETE']);
}
