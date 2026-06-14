/// <reference types="@cloudflare/workers-types" />

/**
 * Pure SQL builders for clock + clock_slot CRUD endpoints.
 *
 * Same conventions as catalog-queries.ts:
 * - station-scoped (mutation paths verify station ownership via WHERE)
 * - parametric only — no SQL string interpolation of user data
 * - framework-free so they can be unit-tested without D1
 */

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

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
  return typeof value === 'string' && (SLOT_TYPES as readonly string[]).includes(value);
}

function requireStationId(stationId: string): void {
  if (!stationId) throw new Error('stationId is required');
}

const CLOCK_COLUMNS = 'id, station_id, name, color, target_duration_ms, created_at';

/* ----------------------------------------------------------------------- */
/* Clocks                                                                  */
/* ----------------------------------------------------------------------- */

export function buildClocksListQuery(stationId: string): BuiltQuery {
  requireStationId(stationId);
  const sql = `SELECT ${CLOCK_COLUMNS}
    FROM clocks
    WHERE station_id = ?
    ORDER BY created_at ASC, id ASC`;
  return { sql, params: [stationId] };
}

/**
 * Single-statement detail: returns clock columns + slot columns (LEFT JOIN)
 * ordered by position. Caller groups rows-per-slot into a clock+slots tree.
 */
export function buildClockDetailQuery(stationId: string, clockId: string): BuiltQuery {
  requireStationId(stationId);
  if (!clockId) throw new Error('clockId is required');
  const sql = `SELECT c.id AS clock_id, c.station_id AS clock_station_id, c.name AS clock_name,
                      c.color AS clock_color, c.target_duration_ms AS clock_target_duration_ms,
                      c.created_at AS clock_created_at,
                      s.id AS slot_id, s.position AS slot_position, s.slot_type AS slot_type,
                      s.category_id AS slot_category_id, s.duration_estimate_ms AS slot_duration_estimate_ms,
                      s.rules_json AS slot_rules_json
    FROM clocks c
    LEFT JOIN clock_slots s ON s.clock_id = c.id
    WHERE c.station_id = ? AND c.id = ?
    ORDER BY s.position ASC NULLS LAST`;
  return { sql, params: [stationId, clockId] };
}

export interface ClockInsertParams {
  id: string;
  stationId: string;
  name: string;
  color?: string;
  targetDurationMs?: number;
}

export function buildClockInsert(p: ClockInsertParams): BuiltQuery {
  requireStationId(p.stationId);
  if (!p.id) throw new Error('id is required');
  if (!p.name) throw new Error('name is required');
  const sql = `INSERT INTO clocks (id, station_id, name, color, target_duration_ms)
    VALUES (?, ?, ?, ?, ?)`;
  return {
    sql,
    params: [p.id, p.stationId, p.name, p.color ?? '#3b82f6', p.targetDurationMs ?? 3600000],
  };
}

export interface ClockUpdateParams {
  stationId: string;
  clockId: string;
  name?: string;
  color?: string;
  targetDurationMs?: number;
}

export function buildClockUpdate(p: ClockUpdateParams): BuiltQuery {
  requireStationId(p.stationId);
  if (!p.clockId) throw new Error('clockId is required');
  const sets: string[] = [];
  const params: unknown[] = [];
  if (p.name !== undefined) {
    sets.push('name = ?');
    params.push(p.name);
  }
  if (p.color !== undefined) {
    sets.push('color = ?');
    params.push(p.color);
  }
  if (p.targetDurationMs !== undefined) {
    sets.push('target_duration_ms = ?');
    params.push(p.targetDurationMs);
  }
  if (sets.length === 0) throw new Error('empty patch');
  const sql = `UPDATE clocks SET ${sets.join(', ')} WHERE id = ? AND station_id = ?`;
  params.push(p.clockId, p.stationId);
  return { sql, params };
}

export function buildClockDelete(stationId: string, clockId: string): BuiltQuery {
  requireStationId(stationId);
  if (!clockId) throw new Error('clockId is required');
  return {
    sql: 'DELETE FROM clocks WHERE id = ? AND station_id = ?',
    params: [clockId, stationId],
  };
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

export function buildSlotInsert(p: SlotInsertParams): BuiltQuery {
  if (!p.id) throw new Error('id is required');
  if (!p.clockId) throw new Error('clockId is required');
  if (!isSlotType(p.slotType)) throw new Error(`invalid slot_type: ${String(p.slotType)}`);
  if (!Number.isFinite(p.position) || p.position < 0) {
    throw new Error('position must be a non-negative integer');
  }
  if (!Number.isFinite(p.durationEstimateMs) || p.durationEstimateMs < 0) {
    throw new Error('durationEstimateMs must be a non-negative integer');
  }
  const sql = `INSERT INTO clock_slots (id, clock_id, position, slot_type, category_id, duration_estimate_ms, rules_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`;
  return {
    sql,
    params: [
      p.id,
      p.clockId,
      p.position,
      p.slotType,
      p.categoryId ?? null,
      p.durationEstimateMs,
      p.rulesJson ?? null,
    ],
  };
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

export function buildSlotUpdate(p: SlotUpdateParams): BuiltQuery {
  if (!p.clockId) throw new Error('clockId is required');
  if (!p.slotId) throw new Error('slotId is required');
  const sets: string[] = [];
  const params: unknown[] = [];
  if (p.position !== undefined) {
    if (!Number.isFinite(p.position) || p.position < 0) {
      throw new Error('position must be a non-negative integer');
    }
    sets.push('position = ?');
    params.push(p.position);
  }
  if (p.slotType !== undefined) {
    if (!isSlotType(p.slotType)) throw new Error(`invalid slot_type: ${String(p.slotType)}`);
    sets.push('slot_type = ?');
    params.push(p.slotType);
  }
  if (p.categoryId !== undefined) {
    sets.push('category_id = ?');
    params.push(p.categoryId);
  }
  if (p.durationEstimateMs !== undefined) {
    if (!Number.isFinite(p.durationEstimateMs) || p.durationEstimateMs < 0) {
      throw new Error('durationEstimateMs must be a non-negative integer');
    }
    sets.push('duration_estimate_ms = ?');
    params.push(p.durationEstimateMs);
  }
  if (p.rulesJson !== undefined) {
    sets.push('rules_json = ?');
    params.push(p.rulesJson);
  }
  if (sets.length === 0) throw new Error('empty patch');
  const sql = `UPDATE clock_slots SET ${sets.join(', ')} WHERE id = ? AND clock_id = ?`;
  params.push(p.slotId, p.clockId);
  return { sql, params };
}

export function buildSlotDelete(clockId: string, slotId: string): BuiltQuery {
  if (!clockId) throw new Error('clockId is required');
  if (!slotId) throw new Error('slotId is required');
  return {
    sql: 'DELETE FROM clock_slots WHERE id = ? AND clock_id = ?',
    params: [slotId, clockId],
  };
}

/**
 * Reorder builder: returns one UPDATE per slot. Caller wraps in a D1 batch
 * so the change is atomic. The unique (clock_id, position) constraint means
 * the caller must move slots to a non-colliding intermediate state, or rely
 * on the batch failing atomically — current callers move to position+1000
 * first, then to the final positions.
 */
export function buildSlotsReorder(
  clockId: string,
  newOrder: { id: string; position: number }[],
): BuiltQuery[] {
  if (!clockId) throw new Error('clockId is required');
  return newOrder.map((entry) => ({
    sql: 'UPDATE clock_slots SET position = ? WHERE id = ? AND clock_id = ?',
    params: [entry.position, entry.id, clockId],
  }));
}
