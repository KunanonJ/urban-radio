/// <reference types="@cloudflare/workers-types" />

/**
 * Pure SQL builders for the schedule_assignments endpoints.
 *
 * Phase 1 weekly grid: each (station, weekday, hour) cell points at a clock.
 * The schema enforces weekday BETWEEN 0 AND 6 and hour BETWEEN 0 AND 23 via
 * CHECK constraints — we mirror those bounds here so we fail fast at the
 * application boundary with a clear error rather than relying on D1 to surface
 * a generic constraint violation.
 *
 * Every builder enforces `WHERE station_id = ?` as its first predicate to
 * eliminate accidental cross-station leakage at the call site.
 */

export interface ScheduleAssignment {
  id: string;
  stationId: string;
  clockId: string;
  /** 0 (Sun) .. 6 (Sat). Matches the migration 0004 CHECK constraint. */
  weekday: number;
  /** 0 .. 23. */
  hour: number;
  validFrom?: string | null;
  validUntil?: string | null;
  rrule?: string | null;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

export interface ScheduleListOptions {
  weekday?: number;
  hour?: number;
}

/**
 * Patch shape accepted by the update builder. All fields are optional. The
 * builder rejects an empty patch (otherwise we'd emit a bogus UPDATE with
 * `SET WHERE …`). A `null` value for `rrule`, `validFrom`, or `validUntil`
 * is treated as an explicit clear and translates to `SET col = NULL`.
 */
export interface ScheduleAssignmentPatch {
  clockId?: string;
  weekday?: number;
  hour?: number;
  validFrom?: string | null;
  validUntil?: string | null;
  rrule?: string | null;
}

function requireStationId(stationId: string): void {
  if (!stationId) throw new Error('stationId is required');
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

const SCHEDULE_COLUMNS =
  'id, station_id, clock_id, weekday, hour, valid_from, valid_until, rrule, created_at';

export function buildScheduleListQuery(
  stationId: string,
  opts?: ScheduleListOptions,
): BuiltQuery {
  requireStationId(stationId);
  const params: unknown[] = [stationId];
  const where: string[] = ['station_id = ?'];

  if (opts?.weekday !== undefined) {
    validateWeekday(opts.weekday);
    where.push('weekday = ?');
    params.push(opts.weekday);
  }
  if (opts?.hour !== undefined) {
    validateHour(opts.hour);
    where.push('hour = ?');
    params.push(opts.hour);
  }

  const sql = `SELECT ${SCHEDULE_COLUMNS}
    FROM schedule_assignments
    WHERE ${where.join(' AND ')}
    ORDER BY weekday ASC, hour ASC`;
  return { sql, params };
}

export function buildScheduleByIdQuery(stationId: string, id: string): BuiltQuery {
  requireStationId(stationId);
  if (!id) throw new Error('id is required');
  const sql = `SELECT ${SCHEDULE_COLUMNS}
    FROM schedule_assignments
    WHERE station_id = ? AND id = ?
    LIMIT 1`;
  return { sql, params: [stationId, id] };
}

export function buildScheduleAssignmentInsert(p: ScheduleAssignment): BuiltQuery {
  if (!p.id) throw new Error('id is required');
  requireStationId(p.stationId);
  if (!p.clockId) throw new Error('clockId is required');
  validateWeekday(p.weekday);
  validateHour(p.hour);

  const sql = `INSERT INTO schedule_assignments
    (id, station_id, clock_id, weekday, hour, valid_from, valid_until, rrule, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`;
  const params: unknown[] = [
    p.id,
    p.stationId,
    p.clockId,
    p.weekday,
    p.hour,
    p.validFrom ?? null,
    p.validUntil ?? null,
    p.rrule ?? null,
  ];
  return { sql, params };
}

export function buildScheduleAssignmentUpdate(
  stationId: string,
  id: string,
  patch: ScheduleAssignmentPatch,
): BuiltQuery {
  requireStationId(stationId);
  if (!id) throw new Error('id is required');

  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.clockId !== undefined) {
    if (!patch.clockId) throw new Error('clockId cannot be empty');
    sets.push('clock_id = ?');
    params.push(patch.clockId);
  }
  if (patch.weekday !== undefined) {
    validateWeekday(patch.weekday);
    sets.push('weekday = ?');
    params.push(patch.weekday);
  }
  if (patch.hour !== undefined) {
    validateHour(patch.hour);
    sets.push('hour = ?');
    params.push(patch.hour);
  }
  if (patch.validFrom !== undefined) {
    sets.push('valid_from = ?');
    params.push(patch.validFrom);
  }
  if (patch.validUntil !== undefined) {
    sets.push('valid_until = ?');
    params.push(patch.validUntil);
  }
  if (patch.rrule !== undefined) {
    sets.push('rrule = ?');
    params.push(patch.rrule);
  }

  if (sets.length === 0) throw new Error('no fields to update');

  // Station + id binds go last to match `WHERE station_id = ? AND id = ?`.
  params.push(stationId, id);

  const sql = `UPDATE schedule_assignments
    SET ${sets.join(', ')}
    WHERE station_id = ? AND id = ?`;
  return { sql, params };
}

export function buildScheduleAssignmentDelete(
  stationId: string,
  id: string,
): BuiltQuery {
  requireStationId(stationId);
  if (!id) throw new Error('id is required');
  const sql = `DELETE FROM schedule_assignments WHERE station_id = ? AND id = ?`;
  return { sql, params: [stationId, id] };
}

/**
 * Find existing assignments that occupy the same (station, weekday, hour) cell.
 *
 * D7 override semantics: only one assignment may live in a single weekday/hour
 * cell at a time. The override-with-dialog pattern at the UI re-POSTs with
 * `?force=1` to delete the conflict and write the new row in one go. Without
 * `?force=1` the API must return 409 with the conflicting rows.
 *
 * `excludeId` is set on PATCH so we don't flag the row currently being edited.
 */
export function buildFindOverlappingAssignments(
  stationId: string,
  weekday: number,
  hour: number,
  excludeId?: string,
): BuiltQuery {
  requireStationId(stationId);
  validateWeekday(weekday);
  validateHour(hour);

  const where: string[] = ['station_id = ?', 'weekday = ?', 'hour = ?'];
  const params: unknown[] = [stationId, weekday, hour];
  if (excludeId) {
    where.push('id != ?');
    params.push(excludeId);
  }

  const sql = `SELECT ${SCHEDULE_COLUMNS}
    FROM schedule_assignments
    WHERE ${where.join(' AND ')}`;
  return { sql, params };
}
