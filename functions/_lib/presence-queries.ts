/// <reference types="@cloudflare/workers-types" />

/**
 * Pure SQL builders for `/api/presence` (Phase 6.1, slim REST-polling
 * collaborative presence).
 *
 * presence_sessions tracks who is actively viewing a polymorphic target
 * (clock, clock_slot, schedule_assignment, voice_track, radio_track,
 * schedule_cell). Clients heartbeat every ~5s; a row is "active" while
 * `last_heartbeat_at > now - 15s`.
 *
 * Mirrors comment-queries.ts: parametric only, framework-free, returns
 * `{ sql, params }`. Every WHERE starts with `station_id = ?` so cross-tenant
 * leakage is structurally impossible at the call site.
 *
 * The `presence_sessions.target_type` column has a CHECK constraint defined
 * in migration 0008. `PRESENCE_TARGET_TYPES` mirrors that constraint so the
 * API layer can validate before reaching D1.
 *
 * Upserts rely on the UNIQUE index `idx_presence_user_target` on
 * (station_id, user_id, target_type, target_id). SQLite ≥ 3.24 supports
 * `INSERT … ON CONFLICT (cols) DO UPDATE`; D1 ships with a much newer
 * SQLite. Verified against migration test
 * `0008_presence > ON CONFLICT DO UPDATE upserts last_heartbeat_at`.
 *
 * Deferred (Phase 6.2): real-time push via WebSocket / Durable Objects,
 * CRDT-backed edit locks / cursor positions, join/leave notifications.
 */

export const PRESENCE_TARGET_TYPES = [
  'clock',
  'clock_slot',
  'schedule_assignment',
  'voice_track',
  'radio_track',
  'schedule_cell',
] as const;

export type PresenceTargetType = (typeof PRESENCE_TARGET_TYPES)[number];

/** A session is "active" while its heartbeat is at most this old, in seconds. */
export const PRESENCE_TTL_SECONDS = 15;

/** Maximum acceptable TTL when callers pass a custom value (defense in depth). */
export const PRESENCE_MAX_TTL_SECONDS = 300;

export function isPresenceTargetType(x: unknown): x is PresenceTargetType {
  return typeof x === 'string' && (PRESENCE_TARGET_TYPES as readonly string[]).includes(x);
}

export interface PresenceRow {
  id: string;
  stationId: string;
  userId: string;
  targetType: PresenceTargetType;
  targetId: string;
  lastHeartbeatAt: string;
  createdAt: string;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

function requireStationId(stationId: string): void {
  if (!stationId) throw new Error('stationId is required');
}

function requireTargetType(t: PresenceTargetType): void {
  if (!isPresenceTargetType(t)) {
    throw new Error(`target_type must be one of ${PRESENCE_TARGET_TYPES.join(', ')}`);
  }
}

function clampTtl(ttlSeconds: number | undefined): number {
  if (
    ttlSeconds === undefined ||
    !Number.isFinite(ttlSeconds) ||
    ttlSeconds <= 0
  ) {
    return PRESENCE_TTL_SECONDS;
  }
  const floored = Math.floor(ttlSeconds);
  if (floored > PRESENCE_MAX_TTL_SECONDS) return PRESENCE_MAX_TTL_SECONDS;
  return floored;
}

export interface PresenceUpsertParams {
  id: string;
  stationId: string;
  userId: string;
  targetType: PresenceTargetType;
  targetId: string;
}

/**
 * Build the heartbeat upsert. Conflict target is the UNIQUE index columns
 * (station_id, user_id, target_type, target_id); a duplicate refreshes
 * `last_heartbeat_at` to now() in UTC. Created_at is preserved across
 * upserts so we can surface "joined N seconds ago" later.
 */
export function buildPresenceUpsert(p: PresenceUpsertParams): BuiltQuery {
  if (!p.id) throw new Error('id is required');
  requireStationId(p.stationId);
  if (!p.userId) throw new Error('userId is required');
  requireTargetType(p.targetType);
  if (!p.targetId) throw new Error('targetId is required');

  const sql = `INSERT INTO presence_sessions
    (id, station_id, user_id, target_type, target_id, last_heartbeat_at, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(station_id, user_id, target_type, target_id) DO UPDATE SET
      last_heartbeat_at = datetime('now')`;

  return {
    sql,
    params: [p.id, p.stationId, p.userId, p.targetType, p.targetId],
  };
}

export interface PresenceListParams {
  stationId: string;
  targetType: PresenceTargetType;
  targetId: string;
  /** Override the default TTL window. Clamped to [1, PRESENCE_MAX_TTL_SECONDS]. */
  ttlSeconds?: number;
}

/**
 * List active sessions for one target, JOINed against `auth_users` so the
 * caller can surface usernames. Ordered by last_heartbeat_at DESC for stable
 * stack rendering. Station_id is the first WHERE predicate by design.
 */
export function buildPresenceListActive(p: PresenceListParams): BuiltQuery {
  requireStationId(p.stationId);
  requireTargetType(p.targetType);
  if (!p.targetId) throw new Error('targetId is required');

  const ttl = clampTtl(p.ttlSeconds);

  const sql = `SELECT
      p.id,
      p.station_id,
      p.user_id,
      p.target_type,
      p.target_id,
      p.last_heartbeat_at,
      p.created_at,
      u.username AS username
    FROM presence_sessions p
    LEFT JOIN auth_users u ON u.id = p.user_id
    WHERE p.station_id = ?
      AND p.target_type = ?
      AND p.target_id = ?
      AND p.last_heartbeat_at > datetime('now', '-${ttl} seconds')
    ORDER BY p.last_heartbeat_at DESC, p.id DESC`;

  return {
    sql,
    params: [p.stationId, p.targetType, p.targetId],
  };
}

/**
 * Best-effort housekeeping. Deletes presence rows whose heartbeat is older
 * than `ttlSeconds`. Safe to run inline on every heartbeat — bounded by the
 * UNIQUE index and the small row count per target.
 */
export function buildPresenceCleanup(ttlSeconds: number): BuiltQuery {
  const ttl = clampTtl(ttlSeconds);
  const sql = `DELETE FROM presence_sessions
    WHERE last_heartbeat_at < datetime('now', '-${ttl} seconds')`;
  return { sql, params: [] };
}
