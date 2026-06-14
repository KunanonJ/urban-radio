/**
 * /api/clocks/[id]/slots/[slotId] — patch + delete a single clock slot.
 *
 * Mirrors `functions/api/clocks/[id]/slots/[slotId].ts`. Station ownership
 * is re-verified by reloading the parent clock detail and confirming the
 * requested slot belongs to it — otherwise a caller could probe slot IDs
 * across stations.
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
  SLOT_TYPES,
  deleteSlot,
  getClockDetail,
  isUniqueViolation,
  updateSlot,
} from '@/server/clock-queries';

interface HandlerDeps {
  db?: DbClient;
  secret?: string;
}

interface RouteCtx {
  params: Promise<{ id: string; slotId: string }>;
}

const slotTypeSchema = z.enum([...SLOT_TYPES]);

const slotUpdateSchema = z.object({
  position: z.number().int().nonnegative().optional(),
  slotType: slotTypeSchema.optional(),
  categoryId: z.string().trim().min(1).max(64).nullable().optional(),
  durationEstimateMs: z.number().int().nonnegative().max(86_400_000).optional(),
  rulesJson: z.string().max(8192).nullable().optional(),
});

export async function patchSlot(
  request: Request,
  clockId: string,
  slotId: string,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // H-05: only admin + programmer may update clock slots.
  const forbidden = requireRole(gate.context, MUTATE_CLOCKS_ROLES);
  if (forbidden) return forbidden;

  if (!clockId || !slotId) return jsonError(404, 'Not found');
  const db = deps.db ?? getDb();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = slotUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }
  if (
    parsed.data.position === undefined &&
    parsed.data.slotType === undefined &&
    parsed.data.categoryId === undefined &&
    parsed.data.durationEstimateMs === undefined &&
    parsed.data.rulesJson === undefined
  ) {
    return jsonError(400, 'Empty patch');
  }

  const owned = await getClockDetail(db, gate.context.stationId, clockId);
  if (!owned) return jsonError(404, 'Not found');
  const before = owned.slots.find((s) => s.id === slotId);
  if (!before) return jsonError(404, 'Not found');

  try {
    await updateSlot(db, {
      clockId,
      slotId,
      position: parsed.data.position,
      slotType: parsed.data.slotType,
      categoryId: parsed.data.categoryId,
      durationEstimateMs: parsed.data.durationEstimateMs,
      rulesJson: parsed.data.rulesJson,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return jsonError(409, 'Slot position already in use');
    }
    return jsonError(500, logAndScrub(err, { tag: 'clocks/[id]/slots/[slotId]/patch' }));
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

  return jsonOk({ ok: true });
}

export async function deleteSlotHandler(
  request: Request,
  clockId: string,
  slotId: string,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // H-05: only admin + programmer may delete clock slots.
  const forbidden = requireRole(gate.context, MUTATE_CLOCKS_ROLES);
  if (forbidden) return forbidden;

  if (!clockId || !slotId) return jsonError(404, 'Not found');
  const db = deps.db ?? getDb();

  const owned = await getClockDetail(db, gate.context.stationId, clockId);
  if (!owned) return jsonError(404, 'Not found');
  const before = owned.slots.find((s) => s.id === slotId);
  if (!before) return jsonError(404, 'Not found');

  try {
    await deleteSlot(db, clockId, slotId);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'clocks/[id]/slots/[slotId]/delete' }));
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

export async function PATCH(
  request: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id, slotId } = await ctx.params;
  return patchSlot(request, id, slotId);
}

export async function DELETE(
  request: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id, slotId } = await ctx.params;
  return deleteSlotHandler(request, id, slotId);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['PATCH', 'DELETE']);
}
