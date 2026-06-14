/**
 * Drizzle-backed query helpers for schedule_assignments endpoints.
 *
 * Next-side port of `functions/_lib/schedule-queries.ts`. Same validation
 * contract — `validateWeekday` and `validateHour` mirror the legacy bounds
 * (0..6 and 0..23 respectively) so both stacks reject the same inputs with
 * the same error messages.
 *
 * Every helper enforces `WHERE station_id = ?` to eliminate accidental
 * cross-station leakage at the call site.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β4.
 */

import { and, asc, eq, ne } from 'drizzle-orm';

import { type DbClient } from '@/db/client';
import { scheduleAssignments } from '@/db/schema';

export interface ScheduleRow {
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

export interface ScheduleListOptions {
  weekday?: number;
  hour?: number;
}

export interface ScheduleAssignmentInput {
  id: string;
  stationId: string;
  clockId: string;
  weekday: number;
  hour: number;
  validFrom?: string | null;
  validUntil?: string | null;
  rrule?: string | null;
}

export interface ScheduleAssignmentPatch {
  clockId?: string;
  weekday?: number;
  hour?: number;
  validFrom?: string | null;
  validUntil?: string | null;
  rrule?: string | null;
}

export function validateWeekday(w: unknown): asserts w is number {
  if (typeof w !== 'number' || !Number.isInteger(w) || w < 0 || w > 6) {
    throw new Error('weekday must be an integer in 0..6');
  }
}

export function validateHour(h: unknown): asserts h is number {
  if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23) {
    throw new Error('hour must be an integer in 0..23');
  }
}

const SELECT_COLUMNS = {
  id: scheduleAssignments.id,
  stationId: scheduleAssignments.stationId,
  clockId: scheduleAssignments.clockId,
  weekday: scheduleAssignments.weekday,
  hour: scheduleAssignments.hour,
  validFrom: scheduleAssignments.validFrom,
  validUntil: scheduleAssignments.validUntil,
  rrule: scheduleAssignments.rrule,
  createdAt: scheduleAssignments.createdAt,
} as const;

export async function listSchedule(
  db: DbClient,
  stationId: string,
  opts?: ScheduleListOptions,
): Promise<ScheduleRow[]> {
  if (!stationId) throw new Error('stationId is required');
  const filters = [eq(scheduleAssignments.stationId, stationId)];
  if (opts?.weekday !== undefined) {
    validateWeekday(opts.weekday);
    filters.push(eq(scheduleAssignments.weekday, opts.weekday));
  }
  if (opts?.hour !== undefined) {
    validateHour(opts.hour);
    filters.push(eq(scheduleAssignments.hour, opts.hour));
  }
  const rows = await db
    .select(SELECT_COLUMNS)
    .from(scheduleAssignments)
    .where(and(...filters))
    .orderBy(asc(scheduleAssignments.weekday), asc(scheduleAssignments.hour));
  return rows;
}

export async function getScheduleById(
  db: DbClient,
  stationId: string,
  id: string,
): Promise<ScheduleRow | null> {
  if (!stationId) throw new Error('stationId is required');
  if (!id) throw new Error('id is required');
  const rows = await db
    .select(SELECT_COLUMNS)
    .from(scheduleAssignments)
    .where(
      and(
        eq(scheduleAssignments.stationId, stationId),
        eq(scheduleAssignments.id, id),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function insertScheduleAssignment(
  db: DbClient,
  p: ScheduleAssignmentInput,
  /** Server-provided creation timestamp. Mirrors `datetime('now')` from D1. */
  createdAt: string,
): Promise<void> {
  if (!p.id) throw new Error('id is required');
  if (!p.stationId) throw new Error('stationId is required');
  if (!p.clockId) throw new Error('clockId is required');
  validateWeekday(p.weekday);
  validateHour(p.hour);
  await db.insert(scheduleAssignments).values({
    id: p.id,
    stationId: p.stationId,
    clockId: p.clockId,
    weekday: p.weekday,
    hour: p.hour,
    validFrom: p.validFrom ?? null,
    validUntil: p.validUntil ?? null,
    rrule: p.rrule ?? null,
    createdAt,
  });
}

export async function updateScheduleAssignment(
  db: DbClient,
  stationId: string,
  id: string,
  patch: ScheduleAssignmentPatch,
): Promise<void> {
  if (!stationId) throw new Error('stationId is required');
  if (!id) throw new Error('id is required');
  const sets: Record<string, unknown> = {};
  if (patch.clockId !== undefined) {
    if (!patch.clockId) throw new Error('clockId cannot be empty');
    sets.clockId = patch.clockId;
  }
  if (patch.weekday !== undefined) {
    validateWeekday(patch.weekday);
    sets.weekday = patch.weekday;
  }
  if (patch.hour !== undefined) {
    validateHour(patch.hour);
    sets.hour = patch.hour;
  }
  if (patch.validFrom !== undefined) sets.validFrom = patch.validFrom;
  if (patch.validUntil !== undefined) sets.validUntil = patch.validUntil;
  if (patch.rrule !== undefined) sets.rrule = patch.rrule;
  if (Object.keys(sets).length === 0) throw new Error('no fields to update');
  await db
    .update(scheduleAssignments)
    .set(sets)
    .where(
      and(
        eq(scheduleAssignments.stationId, stationId),
        eq(scheduleAssignments.id, id),
      ),
    );
}

export async function deleteScheduleAssignment(
  db: DbClient,
  stationId: string,
  id: string,
): Promise<void> {
  if (!stationId) throw new Error('stationId is required');
  if (!id) throw new Error('id is required');
  await db
    .delete(scheduleAssignments)
    .where(
      and(
        eq(scheduleAssignments.stationId, stationId),
        eq(scheduleAssignments.id, id),
      ),
    );
}

export async function findOverlappingAssignments(
  db: DbClient,
  stationId: string,
  weekday: number,
  hour: number,
  excludeId?: string,
): Promise<ScheduleRow[]> {
  if (!stationId) throw new Error('stationId is required');
  validateWeekday(weekday);
  validateHour(hour);
  const filters = [
    eq(scheduleAssignments.stationId, stationId),
    eq(scheduleAssignments.weekday, weekday),
    eq(scheduleAssignments.hour, hour),
  ];
  if (excludeId) filters.push(ne(scheduleAssignments.id, excludeId));
  const rows = await db
    .select(SELECT_COLUMNS)
    .from(scheduleAssignments)
    .where(and(...filters));
  return rows;
}
