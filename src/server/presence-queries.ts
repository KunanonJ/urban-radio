/**
 * Drizzle-side helpers for the station-scoped `/api/presence` endpoints.
 *
 * Mirrors `functions/_lib/presence-queries.ts`. The schema layer keeps the
 * UNIQUE constraint on (station_id, user_id, target_type, target_id), so the
 * heartbeat path can rely on `INSERT … ON CONFLICT DO UPDATE` to refresh
 * `last_heartbeat_at` without a server-side read.
 *
 * Time math (`now - 15s`, `now - {ttl}s`) is expressed via parameterised SQL
 * so we don't have to feed wall-clock strings into Drizzle's value layer; the
 * legacy Cloudflare handler used SQLite's `datetime('now', '-N seconds')`
 * and we keep the same semantics here.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β5.
 */

import { and, desc, eq, gt, sql } from 'drizzle-orm';

import { type DbClient } from '@/db/client';
import { authUsers, presenceSessions } from '@/db/schema';

// ---------------------------------------------------------------------------
// Public constants — match the Cloudflare builder exactly.
// ---------------------------------------------------------------------------

export const PRESENCE_TARGET_TYPES = [
  'clock',
  'clock_slot',
  'schedule_assignment',
  'voice_track',
  'radio_track',
  'schedule_cell',
] as const;

export type PresenceTargetType = (typeof PRESENCE_TARGET_TYPES)[number];

export const PRESENCE_TTL_SECONDS = 15;
export const PRESENCE_MAX_TTL_SECONDS = 300;

export function isPresenceTargetType(x: unknown): x is PresenceTargetType {
  return (
    typeof x === 'string' &&
    (PRESENCE_TARGET_TYPES as readonly string[]).includes(x)
  );
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

// ---------------------------------------------------------------------------
// Row → JSON shape (matches Cloudflare PresenceSessionJson).
// ---------------------------------------------------------------------------

export interface PresenceSessionJson {
  id: string;
  userId: string;
  username: string | null;
  targetType: string;
  targetId: string;
  lastHeartbeatAt: string;
  createdAt: string;
}

interface PresenceSelectRow {
  id: string;
  stationId: string;
  userId: string;
  targetType: string;
  targetId: string;
  lastHeartbeatAt: string;
  createdAt: string;
  username: string | null;
}

export function rowToJson(row: PresenceSelectRow): PresenceSessionJson {
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    targetType: row.targetType,
    targetId: row.targetId,
    lastHeartbeatAt: row.lastHeartbeatAt,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Upsert: INSERT … ON CONFLICT DO UPDATE SET last_heartbeat_at = now.
// ---------------------------------------------------------------------------

export interface PresenceUpsertParams {
  id: string;
  stationId: string;
  userId: string;
  targetType: PresenceTargetType;
  targetId: string;
  /** Optional explicit timestamp (tests). Defaults to ISO `now()` in UTC. */
  now?: string;
}

export async function upsertPresence(
  db: DbClient,
  p: PresenceUpsertParams,
): Promise<void> {
  if (!p.id) throw new Error('id is required');
  if (!p.stationId) throw new Error('stationId is required');
  if (!p.userId) throw new Error('userId is required');
  if (!isPresenceTargetType(p.targetType)) {
    throw new Error(
      `target_type must be one of ${PRESENCE_TARGET_TYPES.join(', ')}`,
    );
  }
  if (!p.targetId) throw new Error('targetId is required');

  const now = p.now ?? new Date().toISOString();
  await db
    .insert(presenceSessions)
    .values({
      id: p.id,
      stationId: p.stationId,
      userId: p.userId,
      targetType: p.targetType,
      targetId: p.targetId,
      lastHeartbeatAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [
        presenceSessions.stationId,
        presenceSessions.userId,
        presenceSessions.targetType,
        presenceSessions.targetId,
      ],
      set: { lastHeartbeatAt: now },
    });
}

// ---------------------------------------------------------------------------
// List active sessions — uses the same time math as the Cloudflare builder.
// ---------------------------------------------------------------------------

export interface PresenceListParams {
  stationId: string;
  targetType: PresenceTargetType;
  targetId: string;
  ttlSeconds?: number;
  /** Optional reference timestamp (tests). Defaults to runtime `now()`. */
  now?: string;
}

function listProjection() {
  return {
    id: presenceSessions.id,
    stationId: presenceSessions.stationId,
    userId: presenceSessions.userId,
    targetType: presenceSessions.targetType,
    targetId: presenceSessions.targetId,
    lastHeartbeatAt: presenceSessions.lastHeartbeatAt,
    createdAt: presenceSessions.createdAt,
    username: authUsers.username,
  };
}

export async function listActivePresence(
  db: DbClient,
  p: PresenceListParams,
): Promise<PresenceSelectRow[]> {
  if (!p.stationId) throw new Error('stationId is required');
  if (!isPresenceTargetType(p.targetType)) {
    throw new Error(
      `target_type must be one of ${PRESENCE_TARGET_TYPES.join(', ')}`,
    );
  }
  if (!p.targetId) throw new Error('targetId is required');

  const ttl = clampTtl(p.ttlSeconds);
  const cutoff = p.now
    ? new Date(new Date(p.now).getTime() - ttl * 1000).toISOString()
    : new Date(Date.now() - ttl * 1000).toISOString();

  return db
    .select(listProjection())
    .from(presenceSessions)
    .leftJoin(authUsers, eq(authUsers.id, presenceSessions.userId))
    .where(
      and(
        eq(presenceSessions.stationId, p.stationId),
        eq(presenceSessions.targetType, p.targetType),
        eq(presenceSessions.targetId, p.targetId),
        gt(presenceSessions.lastHeartbeatAt, cutoff),
      ),
    )
    .orderBy(
      desc(presenceSessions.lastHeartbeatAt),
      desc(presenceSessions.id),
    );
}

// ---------------------------------------------------------------------------
// Best-effort cleanup. Bounded by the small per-target row count.
// ---------------------------------------------------------------------------

export async function cleanupStalePresence(
  db: DbClient,
  ttlSeconds: number,
  now?: string,
): Promise<void> {
  const ttl = clampTtl(ttlSeconds);
  const cutoff = now
    ? new Date(new Date(now).getTime() - ttl * 1000).toISOString()
    : new Date(Date.now() - ttl * 1000).toISOString();
  await db
    .delete(presenceSessions)
    .where(sql`${presenceSessions.lastHeartbeatAt} < ${cutoff}`);
}
