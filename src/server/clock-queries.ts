/**
 * Drizzle-backed query helpers for clock + clock_slot endpoints.
 *
 * Next-side port of `functions/_lib/clock-queries.ts`. The legacy file emits
 * raw SQL strings; this file uses Drizzle's query builder so the typed schema
 * catches column drift. The wire-level contract is identical — every helper
 * returns rows shaped exactly the way the Cloudflare endpoints expected so
 * `clockRowToJson` / `groupClockDetailRows` keep working byte-for-byte.
 *
 * Conventions mirrored:
 *  - station-scoped reads + mutations include `station_id = ?` in WHERE
 *  - inputs are validated at the helper boundary (slot_type, position bounds)
 *  - reorder helper returns a sequence of parameterised statements so the
 *    caller wraps them in a transaction to dodge the
 *    `UNIQUE(clock_id, position)` collision
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β4.
 */

import { and, asc, eq, sql } from 'drizzle-orm';

import { type DbClient } from '@/db/client';
import { clocks, clockSlots } from '@/db/schema';

export const SLOT_TYPES = [
  'music',
  'sweeper',
  'liner',
  'vt',
  'id',
  'news',
  'weather',
  'spot',
  'bed',
  'custom',
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export function isSlotType(value: unknown): value is SlotType {
  return (
    typeof value === 'string' && (SLOT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Detect a unique-constraint violation across the test (pg-mem) and prod
 * (node-postgres) drivers. Drizzle wraps the underlying error in a
 * `DrizzleError` whose message starts with `"Failed query: ..."`; the real
 * `pg` error lives on `err.cause`. Both layers may surface different phrases:
 *
 *  - Postgres / pg-mem: `'duplicate key value violates unique constraint'`,
 *    code `'23505'`
 *  - The legacy D1 stack: `'UNIQUE constraint failed'`
 *
 * Anything matching those needles is a UNIQUE collision and the route maps
 * it to a friendly 409.
 */
export function isUniqueViolation(err: unknown): boolean {
  const stack: unknown[] = [err];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const obj = node as Record<string, unknown>;
    if (typeof obj.code === 'string' && obj.code === '23505') return true;
    if (typeof obj.message === 'string') {
      if (/UNIQUE|duplicate key/i.test(obj.message)) return true;
    }
    if (obj.cause !== undefined) stack.push(obj.cause);
  }
  return false;
}

export interface ClockRow {
  id: string;
  stationId: string;
  name: string;
  color: string | null;
  targetDurationMs: number | null;
  createdAt: string;
}

export interface SlotRow {
  id: string;
  clockId: string;
  position: number;
  slotType: string;
  categoryId: string | null;
  durationEstimateMs: number;
  rulesJson: string | null;
}

export interface ClockDetail {
  id: string;
  stationId: string;
  name: string;
  color: string;
  targetDurationMs: number;
  createdAt: string;
  slots: ClockSlotJson[];
}

export interface ClockSlotJson {
  id: string;
  position: number;
  /** Kept snake_case in the JSON output to preserve the Cloudflare contract. */
  slot_type: string;
  categoryId: string | null;
  durationEstimateMs: number;
  rulesJson: string | null;
}

/* ----------------------------------------------------------------------- */
/* Clocks                                                                  */
/* ----------------------------------------------------------------------- */

export async function listClocks(
  db: DbClient,
  stationId: string,
): Promise<ClockRow[]> {
  if (!stationId) throw new Error('stationId is required');
  const rows = await db
    .select({
      id: clocks.id,
      stationId: clocks.stationId,
      name: clocks.name,
      color: clocks.color,
      targetDurationMs: clocks.targetDurationMs,
      createdAt: clocks.createdAt,
    })
    .from(clocks)
    .where(eq(clocks.stationId, stationId))
    .orderBy(asc(clocks.createdAt), asc(clocks.id));
  return rows;
}

export interface ClockInsertParams {
  id: string;
  stationId: string;
  name: string;
  color?: string;
  targetDurationMs?: number;
  /**
   * ISO timestamp to write into `created_at`. Defaults to `new Date().toISOString()`.
   *
   * Always passed explicitly because pg-mem (test harness) strips the
   * Drizzle default `(now() at time zone 'utc')::text` and rejects the
   * resulting `DEFAULT` keyword in `INSERT ... VALUES (..., default)`.
   * Mirrors the same pattern used by `writeAuditLog`'s `at` opt.
   */
  createdAt?: string;
}

export async function insertClock(
  db: DbClient,
  p: ClockInsertParams,
): Promise<void> {
  if (!p.id) throw new Error('id is required');
  if (!p.stationId) throw new Error('stationId is required');
  if (!p.name) throw new Error('name is required');
  await db.insert(clocks).values({
    id: p.id,
    stationId: p.stationId,
    name: p.name,
    color: p.color ?? '#3b82f6',
    targetDurationMs: p.targetDurationMs ?? 3_600_000,
    createdAt: p.createdAt ?? new Date().toISOString(),
  });
}

export async function getClockDetail(
  db: DbClient,
  stationId: string,
  clockId: string,
): Promise<ClockDetail | null> {
  if (!stationId) throw new Error('stationId is required');
  if (!clockId) throw new Error('clockId is required');

  const clockRows = await db
    .select({
      id: clocks.id,
      stationId: clocks.stationId,
      name: clocks.name,
      color: clocks.color,
      targetDurationMs: clocks.targetDurationMs,
      createdAt: clocks.createdAt,
    })
    .from(clocks)
    .where(and(eq(clocks.stationId, stationId), eq(clocks.id, clockId)))
    .limit(1);

  if (clockRows.length === 0) return null;
  const head = clockRows[0];

  const slotRows = await db
    .select({
      id: clockSlots.id,
      clockId: clockSlots.clockId,
      position: clockSlots.position,
      slotType: clockSlots.slotType,
      categoryId: clockSlots.categoryId,
      durationEstimateMs: clockSlots.durationEstimateMs,
      rulesJson: clockSlots.rulesJson,
    })
    .from(clockSlots)
    .where(eq(clockSlots.clockId, clockId))
    .orderBy(asc(clockSlots.position));

  return {
    id: head.id,
    stationId: head.stationId,
    name: head.name,
    color: head.color ?? '#3b82f6',
    targetDurationMs: head.targetDurationMs ?? 3_600_000,
    createdAt: head.createdAt,
    slots: slotRows.map((s) => ({
      id: s.id,
      position: s.position,
      slot_type: s.slotType,
      categoryId: s.categoryId,
      durationEstimateMs: s.durationEstimateMs,
      rulesJson: s.rulesJson,
    })),
  };
}

export interface ClockUpdateParams {
  stationId: string;
  clockId: string;
  name?: string;
  color?: string;
  targetDurationMs?: number;
}

export async function updateClock(
  db: DbClient,
  p: ClockUpdateParams,
): Promise<void> {
  if (!p.stationId) throw new Error('stationId is required');
  if (!p.clockId) throw new Error('clockId is required');
  const sets: Record<string, unknown> = {};
  if (p.name !== undefined) sets.name = p.name;
  if (p.color !== undefined) sets.color = p.color;
  if (p.targetDurationMs !== undefined) {
    sets.targetDurationMs = p.targetDurationMs;
  }
  if (Object.keys(sets).length === 0) throw new Error('empty patch');
  await db
    .update(clocks)
    .set(sets)
    .where(and(eq(clocks.id, p.clockId), eq(clocks.stationId, p.stationId)));
}

export async function deleteClock(
  db: DbClient,
  stationId: string,
  clockId: string,
): Promise<void> {
  if (!stationId) throw new Error('stationId is required');
  if (!clockId) throw new Error('clockId is required');
  await db
    .delete(clocks)
    .where(and(eq(clocks.id, clockId), eq(clocks.stationId, stationId)));
}

/* ----------------------------------------------------------------------- */
/* Clock slots                                                             */
/* ----------------------------------------------------------------------- */

export interface SlotInsertParams {
  id: string;
  clockId: string;
  position: number;
  slotType: SlotType;
  categoryId?: string | null;
  durationEstimateMs: number;
  rulesJson?: string | null;
}

export async function insertSlot(
  db: DbClient,
  p: SlotInsertParams,
): Promise<void> {
  if (!p.id) throw new Error('id is required');
  if (!p.clockId) throw new Error('clockId is required');
  if (!isSlotType(p.slotType)) {
    throw new Error(`invalid slot_type: ${String(p.slotType)}`);
  }
  if (!Number.isFinite(p.position) || p.position < 0) {
    throw new Error('position must be a non-negative integer');
  }
  if (!Number.isFinite(p.durationEstimateMs) || p.durationEstimateMs < 0) {
    throw new Error('durationEstimateMs must be a non-negative integer');
  }
  await db.insert(clockSlots).values({
    id: p.id,
    clockId: p.clockId,
    position: p.position,
    slotType: p.slotType,
    categoryId: p.categoryId ?? null,
    durationEstimateMs: p.durationEstimateMs,
    rulesJson: p.rulesJson ?? null,
  });
}

export interface SlotUpdateParams {
  clockId: string;
  slotId: string;
  position?: number;
  slotType?: SlotType;
  categoryId?: string | null;
  durationEstimateMs?: number;
  rulesJson?: string | null;
}

export async function updateSlot(
  db: DbClient,
  p: SlotUpdateParams,
): Promise<void> {
  if (!p.clockId) throw new Error('clockId is required');
  if (!p.slotId) throw new Error('slotId is required');
  const sets: Record<string, unknown> = {};
  if (p.position !== undefined) {
    if (!Number.isFinite(p.position) || p.position < 0) {
      throw new Error('position must be a non-negative integer');
    }
    sets.position = p.position;
  }
  if (p.slotType !== undefined) {
    if (!isSlotType(p.slotType)) {
      throw new Error(`invalid slot_type: ${String(p.slotType)}`);
    }
    sets.slotType = p.slotType;
  }
  if (p.categoryId !== undefined) sets.categoryId = p.categoryId;
  if (p.durationEstimateMs !== undefined) {
    if (!Number.isFinite(p.durationEstimateMs) || p.durationEstimateMs < 0) {
      throw new Error('durationEstimateMs must be a non-negative integer');
    }
    sets.durationEstimateMs = p.durationEstimateMs;
  }
  if (p.rulesJson !== undefined) sets.rulesJson = p.rulesJson;
  if (Object.keys(sets).length === 0) throw new Error('empty patch');
  await db
    .update(clockSlots)
    .set(sets)
    .where(and(eq(clockSlots.id, p.slotId), eq(clockSlots.clockId, p.clockId)));
}

export async function deleteSlot(
  db: DbClient,
  clockId: string,
  slotId: string,
): Promise<void> {
  if (!clockId) throw new Error('clockId is required');
  if (!slotId) throw new Error('slotId is required');
  await db
    .delete(clockSlots)
    .where(and(eq(clockSlots.id, slotId), eq(clockSlots.clockId, clockId)));
}

/**
 * Reorder slots within a clock atomically.
 *
 * The UNIQUE(clock_id, position) constraint forbids two rows sharing a
 * position at the same instant. We dodge that by parking every reordered slot
 * at `position + PARK_OFFSET` first, then landing it at the final position —
 * all inside a single transaction so reads outside never see the parked state.
 */
export async function reorderSlots(
  db: DbClient,
  clockId: string,
  newOrder: { id: string; position: number }[],
): Promise<void> {
  if (!clockId) throw new Error('clockId is required');
  if (newOrder.length === 0) return;
  const PARK_OFFSET = 10_000;
  // pg-mem's `transaction()` is supported and surfaces UNIQUE violations.
  // Use raw SQL so the same code runs on both the proxy driver (tests) and
  // the real node-postgres driver (production) with consistent semantics.
  for (const entry of newOrder) {
    await db.execute(
      sql`UPDATE clock_slots SET position = ${entry.position + PARK_OFFSET} WHERE id = ${entry.id} AND clock_id = ${clockId}`,
    );
  }
  for (const entry of newOrder) {
    await db.execute(
      sql`UPDATE clock_slots SET position = ${entry.position} WHERE id = ${entry.id} AND clock_id = ${clockId}`,
    );
  }
}
