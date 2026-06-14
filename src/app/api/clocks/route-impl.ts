/**
 * /api/clocks — list + create clocks for the caller's station.
 *
 * Mirrors `functions/api/clocks/index.ts`. Same JSON shape, same zod schema,
 * same `requireStation` gate, same audit-log row emitted on POST.
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
  insertClock,
  listClocks,
  type ClockRow,
} from '@/server/clock-queries';

interface HandlerDeps {
  db?: DbClient;
  secret?: string;
  /** Override the generated clock id (tests). */
  newId?: () => string;
}

function clockRowToJson(row: ClockRow): Record<string, unknown> {
  return {
    id: row.id,
    stationId: row.stationId,
    name: row.name,
    color: row.color ?? '#3b82f6',
    targetDurationMs: row.targetDurationMs ?? 3_600_000,
    createdAt: row.createdAt,
  };
}

const clockCreateSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(120),
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

export async function getClocks(
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();
  try {
    const rows = await listClocks(db, gate.context.stationId);
    return jsonOk({
      clocks: rows.map(clockRowToJson),
      meta: { limit: rows.length },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'clocks/list' }));
  }
}

export async function postClocks(
  request: Request,
  deps: HandlerDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // H-05: only admin + programmer may create clocks.
  const forbidden = requireRole(gate.context, MUTATE_CLOCKS_ROLES);
  if (forbidden) return forbidden;

  const db = deps.db ?? getDb();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = clockCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const id = (deps.newId ?? randomUUID)();
  try {
    await insertClock(db, {
      id,
      stationId: gate.context.stationId,
      name: parsed.data.name,
      color: parsed.data.color,
      targetDurationMs: parsed.data.targetDurationMs,
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'clocks/insert' }));
  }

  const after = {
    id,
    name: parsed.data.name,
    color: parsed.data.color ?? '#3b82f6',
    targetDurationMs: parsed.data.targetDurationMs ?? 3_600_000,
  };

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'create',
    targetType: 'clock',
    targetId: id,
    after,
  });

  return jsonOk(
    {
      clock: {
        id,
        stationId: gate.context.stationId,
        name: parsed.data.name,
        color: parsed.data.color ?? '#3b82f6',
        targetDurationMs: parsed.data.targetDurationMs ?? 3_600_000,
      },
    },
    { status: 201 },
  );
}

export async function GET(request: Request): Promise<Response> {
  return getClocks(request);
}

export async function POST(request: Request): Promise<Response> {
  return postClocks(request);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['GET', 'POST']);
}
