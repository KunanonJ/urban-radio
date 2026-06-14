/**
 * /api/clocks/[id]/slots — create a slot inside a clock + reorder slots.
 *
 * Mirrors `functions/api/clocks/[id]/slots.ts`. PUT body shape:
 *   { order: [{ id, position }, ...] }
 *
 * The reorder helper parks every slot at `position + 10_000` first, then
 * lands at the final position — see `reorderSlots` in
 * `src/server/clock-queries.ts` for the rationale.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β4.
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { requireRole, MUTATE_CLOCKS_ROLES } from '@/server/auth/require-role';
import { writeAuditLog } from '@/server/audit-log';
import { logAndScrub } from '@/server/internal-error';
import {
  SLOT_TYPES,
  getClockDetail,
  insertSlot,
  isUniqueViolation,
  reorderSlots,
} from '@/server/clock-queries';

interface HandlerDeps {
  db?: DbClient;
  secret?: string;
  newId?: () => string;
}

interface RouteCtx {
  params: Promise<{ id: string }>;
}

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

export async function postSlot(
  request: Request,
  clockId: string,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // H-05: only admin + programmer may create clock slots.
  const forbidden = requireRole(gate.context, MUTATE_CLOCKS_ROLES);
  if (forbidden) return forbidden;

  if (!clockId) return jsonError(404, 'Not found');
  const db = deps.db ?? getDb();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = slotCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  // Verify clock exists and belongs to caller's station.
  const owned = await getClockDetail(db, gate.context.stationId, clockId);
  if (!owned) return jsonError(404, 'Not found');

  const slotId = (deps.newId ?? randomUUID)();
  try {
    await insertSlot(db, {
      id: slotId,
      clockId,
      position: parsed.data.position,
      slotType: parsed.data.slotType,
      categoryId: parsed.data.categoryId ?? null,
      durationEstimateMs: parsed.data.durationEstimateMs,
      rulesJson: parsed.data.rulesJson ?? null,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return jsonError(409, 'Slot position already in use');
    }
    return jsonError(500, logAndScrub(err, { tag: 'clocks/[id]/slots/insert' }));
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

  return jsonOk(
    {
      slot: {
        id: slotId,
        clockId,
        position: parsed.data.position,
        slotType: parsed.data.slotType,
        categoryId: parsed.data.categoryId ?? null,
        durationEstimateMs: parsed.data.durationEstimateMs,
        rulesJson: parsed.data.rulesJson ?? null,
      },
    },
    { status: 201 },
  );
}

export async function putSlots(
  request: Request,
  clockId: string,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // H-05: only admin + programmer may reorder clock slots.
  const forbidden = requireRole(gate.context, MUTATE_CLOCKS_ROLES);
  if (forbidden) return forbidden;

  if (!clockId) return jsonError(404, 'Not found');
  const db = deps.db ?? getDb();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = reorderSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const owned = await getClockDetail(db, gate.context.stationId, clockId);
  if (!owned) return jsonError(404, 'Not found');

  try {
    await reorderSlots(db, clockId, parsed.data.order);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'clocks/[id]/slots/reorder' }));
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'reorder',
    targetType: 'clock_slot',
    targetId: clockId,
    before: {
      order: owned.slots.map((s) => ({ id: s.id, position: s.position })),
    },
    after: { order: parsed.data.order },
  });

  return jsonOk({ ok: true, order: parsed.data.order });
}

export async function POST(
  request: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;
  return postSlot(request, id);
}

export async function PUT(
  request: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const { id } = await ctx.params;
  return putSlots(request, id);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['POST', 'PUT']);
}
