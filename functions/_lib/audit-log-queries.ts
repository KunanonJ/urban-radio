/// <reference types="@cloudflare/workers-types" />

/**
 * Pure SQL builders for the station-scoped /api/audit-log endpoints.
 *
 * Same conventions as `play-log-queries.ts` and `report-queries.ts`:
 *   - station-scoped: every builder requires a stationId and uses it as the
 *     first WHERE predicate.
 *   - parametric only — user data never interpolated into SQL strings.
 *   - framework-free so it can be unit-tested without spinning up D1.
 *
 * The list query joins `audit_log` to `auth_users` via LEFT JOIN so we can
 * surface `actor.username` to the UI without an extra round-trip — and the
 * row still appears with `username = NULL` if the actor has been deleted.
 *
 * Keyset pagination is performed on `(at, id) DESC` — matching the index
 * `idx_audit_station_at`. This gives stable ordering even when many entries
 * land in the same millisecond, and lets the keyset compare with `(at, id) < (?, ?)`.
 *
 * The CSV variant orders ASC for deterministic export output and uses a
 * `LIMIT rowCap + 1` (parametric) so the endpoint can detect overflow and
 * return a 413 instead of silently truncating.
 */

export const AUDIT_LOG_DEFAULT_LIMIT = 50;
export const AUDIT_LOG_MAX_LIMIT = 200;

export interface AuditLogFilters {
  /** Exact match on `audit_log.actor_user_id`. */
  actorUserId?: string;
  /** Exact match on `audit_log.action`. */
  action?: string;
  /** Exact match on `audit_log.target_type`. */
  targetType?: string;
  /** ISO 8601 lower bound, inclusive (matches `at >= ?`). */
  from?: string;
  /** ISO 8601 upper bound, exclusive (matches `at < ?`). */
  to?: string;
  /** LIKE search across `before_json` and `after_json`. */
  search?: string;
}

export interface AuditLogKeysetCursor {
  lastAt: string;
  lastId: string;
}

export interface ListAuditLogParams {
  stationId: string;
  filters: AuditLogFilters;
  cursor?: AuditLogKeysetCursor;
  limit: number;
}

export interface CsvAuditLogParams {
  stationId: string;
  filters: AuditLogFilters;
  rowCap: number;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

export function clampLimit(value: number | undefined, max: number, def: number): number {
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

export function decodeCursor(input: string | undefined | null): AuditLogKeysetCursor | null {
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

function appendFilters(
  filters: AuditLogFilters,
  where: string[],
  params: unknown[],
): void {
  if (filters.actorUserId) {
    where.push('a.actor_user_id = ?');
    params.push(filters.actorUserId);
  }
  if (filters.action) {
    where.push('a.action = ?');
    params.push(filters.action);
  }
  if (filters.targetType) {
    where.push('a.target_type = ?');
    params.push(filters.targetType);
  }
  if (filters.from) {
    where.push('a.at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('a.at < ?');
    params.push(filters.to);
  }
  if (filters.search) {
    // LIKE across both before_json and after_json. Lowercased on both sides
    // so callers don't have to think about case. The trailing `?` is bound,
    // never interpolated.
    where.push('(LOWER(COALESCE(a.before_json, \'\')) LIKE ? OR LOWER(COALESCE(a.after_json, \'\')) LIKE ?)');
    const wildcard = `%${filters.search.toLowerCase()}%`;
    params.push(wildcard, wildcard);
  }
}

const AUDIT_LOG_COLUMNS = `
  a.id          AS id,
  a.station_id  AS station_id,
  a.actor_user_id AS actor_user_id,
  a.action      AS action,
  a.target_type AS target_type,
  a.target_id   AS target_id,
  a.before_json AS before_json,
  a.after_json  AS after_json,
  a.at          AS at,
  u.username    AS actor_username
`;

/**
 * Keyset-paginated list. Returns the requested page in DESC order so the
 * newest rows show up first.
 *
 *   SELECT ... FROM audit_log a
 *   LEFT JOIN auth_users u ON u.id = a.actor_user_id
 *   WHERE a.station_id = ?
 *     [AND a.actor_user_id = ?]
 *     [AND a.action = ?]
 *     [AND a.target_type = ?]
 *     [AND a.at >= ?]
 *     [AND a.at < ?]
 *     [AND (LOWER(a.before_json) LIKE ? OR LOWER(a.after_json) LIKE ?)]
 *     [AND (a.at, a.id) < (?, ?)]
 *   ORDER BY a.at DESC, a.id DESC
 *   LIMIT N
 */
export function buildAuditLogListQuery(p: ListAuditLogParams): BuiltQuery {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit, AUDIT_LOG_MAX_LIMIT, AUDIT_LOG_DEFAULT_LIMIT);

  const where: string[] = ['a.station_id = ?'];
  const params: unknown[] = [p.stationId];

  appendFilters(p.filters, where, params);

  if (p.cursor) {
    where.push('(a.at, a.id) < (?, ?)');
    params.push(p.cursor.lastAt, p.cursor.lastId);
  }

  const sql = `SELECT ${AUDIT_LOG_COLUMNS}
    FROM audit_log a
    LEFT JOIN auth_users u ON u.id = a.actor_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.at DESC, a.id DESC
    LIMIT ${limit}`;

  return { sql, params };
}

/**
 * CSV-export query. Same filter surface as the list, but:
 *   - no cursor (one-shot export)
 *   - ORDER BY ASC for deterministic file output
 *   - LIMIT rowCap + 1 as a parametric bind — the endpoint compares
 *     `rows.length > rowCap` to decide whether to 413.
 */
export function buildAuditLogCsvQuery(p: CsvAuditLogParams): BuiltQuery {
  requireStationId(p.stationId);
  if (!Number.isFinite(p.rowCap) || p.rowCap <= 0) {
    throw new Error('rowCap must be a positive integer');
  }

  const where: string[] = ['a.station_id = ?'];
  const params: unknown[] = [p.stationId];

  appendFilters(p.filters, where, params);

  const sql = `SELECT ${AUDIT_LOG_COLUMNS}
    FROM audit_log a
    LEFT JOIN auth_users u ON u.id = a.actor_user_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.at ASC, a.id ASC
    LIMIT ?`;

  params.push(Math.floor(p.rowCap) + 1);
  return { sql, params };
}
