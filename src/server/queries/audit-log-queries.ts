/**
 * Drizzle/Postgres helpers for the station-scoped /api/audit-log endpoint —
 * Next-side port of `functions/_lib/audit-log-queries.ts`.
 *
 *   - station-scoped: stationId is the first WHERE predicate, never bypassed.
 *   - keyset pagination on `(at, id) DESC` — matches the
 *     `idx_audit_station_at` index. Stable when many rows share a millisecond.
 *   - LEFT JOIN on `auth_users` so callers can surface `actor.username`
 *     without another round-trip; row still appears when the actor row was
 *     deleted (username comes back NULL).
 *   - CSV export uses the same filter surface, ORDER BY ASC for determinism,
 *     and `LIMIT rowCap + 1` so the endpoint can detect overflow.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β6.
 */

import { sql, type SQL } from 'drizzle-orm';

import type { DbClient } from '@/db/client';

export const AUDIT_LOG_DEFAULT_LIMIT = 50;
export const AUDIT_LOG_MAX_LIMIT = 200;

export interface AuditLogFilters {
  /** Exact match on `audit_log.actor_user_id`. */
  actorUserId?: string;
  /** Exact match on `audit_log.action`. */
  action?: string;
  /** Exact match on `audit_log.target_type`. */
  targetType?: string;
  /** ISO 8601 lower bound, inclusive (`at >= ?`). */
  from?: string;
  /** ISO 8601 upper bound, exclusive (`at < ?`). */
  to?: string;
  /** Case-insensitive LIKE across `before_json` and `after_json`. */
  search?: string;
}

export interface AuditLogKeysetCursor {
  lastAt: string;
  lastId: string;
}

export interface AuditLogRow {
  id: string;
  stationId: string;
  actorUserId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  beforeJson: string | null;
  afterJson: string | null;
  at: string;
  actorUsername: string | null;
}

export function clampLimit(
  value: number | undefined,
  max: number,
  def: number,
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return def;
  if (value > max) return max;
  return Math.floor(value);
}

function toBase64Url(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64url');
  }
  const b64 = btoa(input);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'base64url').toString('utf8');
  }
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return atob(b64);
}

export function encodeCursor(cursor: AuditLogKeysetCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

export function decodeCursor(
  input: string | undefined | null,
): AuditLogKeysetCursor | null {
  if (!input) return null;
  try {
    const json = fromBase64Url(input);
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { lastAt?: unknown }).lastAt === 'string' &&
      typeof (parsed as { lastId?: unknown }).lastId === 'string'
    ) {
      return parsed as AuditLogKeysetCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function requireStationId(stationId: string): void {
  if (!stationId) throw new Error('stationId is required');
}

function appendFilters(filters: AuditLogFilters, parts: SQL[]): void {
  if (filters.actorUserId) {
    parts.push(sql`a.actor_user_id = ${filters.actorUserId}`);
  }
  if (filters.action) {
    parts.push(sql`a.action = ${filters.action}`);
  }
  if (filters.targetType) {
    parts.push(sql`a.target_type = ${filters.targetType}`);
  }
  if (filters.from) {
    parts.push(sql`a.at >= ${filters.from}`);
  }
  if (filters.to) {
    parts.push(sql`a.at < ${filters.to}`);
  }
  if (filters.search) {
    const wildcard = `%${filters.search.toLowerCase()}%`;
    parts.push(
      sql`(LOWER(COALESCE(a.before_json, '')) LIKE ${wildcard} OR LOWER(COALESCE(a.after_json, '')) LIKE ${wildcard})`,
    );
  }
}

interface ExecResult {
  rows: Array<Record<string, unknown>>;
}

async function execRows(
  db: DbClient,
  statement: SQL,
): Promise<ExecResult['rows']> {
  const raw = (await db.execute(statement)) as
    | ExecResult
    | Array<Record<string, unknown>>;
  return Array.isArray(raw) ? raw : (raw.rows ?? []);
}

function mapRow(row: Record<string, unknown>): AuditLogRow {
  return {
    id: String(row.id),
    stationId: String(row.station_id),
    actorUserId:
      row.actor_user_id === null || row.actor_user_id === undefined
        ? null
        : String(row.actor_user_id),
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    beforeJson:
      row.before_json === null || row.before_json === undefined
        ? null
        : String(row.before_json),
    afterJson:
      row.after_json === null || row.after_json === undefined
        ? null
        : String(row.after_json),
    at: String(row.at),
    actorUsername:
      row.actor_username === null || row.actor_username === undefined
        ? null
        : String(row.actor_username),
  };
}

export interface ListAuditLogParams {
  stationId: string;
  filters: AuditLogFilters;
  cursor?: AuditLogKeysetCursor;
  limit: number;
}

/**
 * Keyset-paginated list. Newest rows first.
 *
 *   SELECT … FROM audit_log a LEFT JOIN auth_users u ON u.id = a.actor_user_id
 *   WHERE a.station_id = ?
 *     [AND a.actor_user_id = ?] [AND a.action = ?] [AND a.target_type = ?]
 *     [AND a.at >= ?]           [AND a.at < ?]
 *     [AND (LOWER(a.before_json) LIKE ? OR LOWER(a.after_json) LIKE ?)]
 *     [AND (a.at, a.id) < (?, ?)]
 *   ORDER BY a.at DESC, a.id DESC
 *   LIMIT N
 */
export async function queryAuditLogList(
  db: DbClient,
  p: ListAuditLogParams,
): Promise<AuditLogRow[]> {
  requireStationId(p.stationId);
  const limit = clampLimit(
    p.limit,
    AUDIT_LOG_MAX_LIMIT,
    AUDIT_LOG_DEFAULT_LIMIT,
  );

  const parts: SQL[] = [sql`a.station_id = ${p.stationId}`];
  appendFilters(p.filters, parts);
  if (p.cursor) {
    parts.push(
      sql`(a.at, a.id) < (${p.cursor.lastAt}, ${p.cursor.lastId})`,
    );
  }
  const where = sql.join(parts, sql` AND `);

  const statement = sql`SELECT
      a.id            AS id,
      a.station_id    AS station_id,
      a.actor_user_id AS actor_user_id,
      a.action        AS action,
      a.target_type   AS target_type,
      a.target_id     AS target_id,
      a.before_json   AS before_json,
      a.after_json    AS after_json,
      a.at            AS at,
      u.username      AS actor_username
    FROM audit_log a
    LEFT JOIN auth_users u ON u.id = a.actor_user_id
    WHERE ${where}
    ORDER BY a.at DESC, a.id DESC
    LIMIT ${limit}`;

  const rows = await execRows(db, statement);
  return rows.map(mapRow);
}

export interface CsvAuditLogParams {
  stationId: string;
  filters: AuditLogFilters;
  rowCap: number;
}

/**
 * CSV export — same filter surface as the list but:
 *   - no cursor (one-shot export)
 *   - ORDER BY ASC for deterministic file output
 *   - LIMIT rowCap + 1 so the endpoint can compare rows.length > rowCap to 413
 */
export async function queryAuditLogCsv(
  db: DbClient,
  p: CsvAuditLogParams,
): Promise<AuditLogRow[]> {
  requireStationId(p.stationId);
  if (!Number.isFinite(p.rowCap) || p.rowCap <= 0) {
    throw new Error('rowCap must be a positive integer');
  }
  const cap = Math.floor(p.rowCap) + 1;

  const parts: SQL[] = [sql`a.station_id = ${p.stationId}`];
  appendFilters(p.filters, parts);
  const where = sql.join(parts, sql` AND `);

  const statement = sql`SELECT
      a.id            AS id,
      a.station_id    AS station_id,
      a.actor_user_id AS actor_user_id,
      a.action        AS action,
      a.target_type   AS target_type,
      a.target_id     AS target_id,
      a.before_json   AS before_json,
      a.after_json    AS after_json,
      a.at            AS at,
      u.username      AS actor_username
    FROM audit_log a
    LEFT JOIN auth_users u ON u.id = a.actor_user_id
    WHERE ${where}
    ORDER BY a.at ASC, a.id ASC
    LIMIT ${cap}`;

  const rows = await execRows(db, statement);
  return rows.map(mapRow);
}
