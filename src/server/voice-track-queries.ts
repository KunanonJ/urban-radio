/**
 * Drizzle-side helpers for the station-scoped voice_tracks endpoints.
 *
 * Mirrors `functions/_lib/voice-track-queries.ts` but the SQL is expressed
 * through Drizzle's query builder instead of hand-rolled prepared statements,
 * so the same logic runs against the Railway Postgres mirror that backs the
 * new Next.js route handlers.
 *
 * Validation constants (status enum, default/max limit, base64-url cursor) are
 * re-implemented here so the Next routes do not depend on the Cloudflare
 * `functions/` tree. The behaviour must remain byte-identical with the legacy
 * handlers throughout the dual-stack window.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β5.
 */

import { and, desc, eq, lt, or, sql } from 'drizzle-orm';

import { type DbClient } from '@/db/client';
import { voiceTracks } from '@/db/schema';

// ---------------------------------------------------------------------------
// Public constants — match the Cloudflare builder exactly.
// ---------------------------------------------------------------------------

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export const VT_STATUSES = ['draft', 'ready', 'aired', 'archived'] as const;
export type VtStatus = (typeof VT_STATUSES)[number];

export function isAllowedStatus(value: unknown): value is VtStatus {
  return (
    typeof value === 'string' &&
    (VT_STATUSES as readonly string[]).includes(value)
  );
}

export interface VoiceTrackKeysetCursor {
  lastCreatedAt: string;
  lastId: string;
}

export interface ListVoiceTracksParams {
  stationId: string;
  status?: VtStatus;
  targetClockSlotId?: string;
  cursor?: VoiceTrackKeysetCursor;
  limit: number;
}

/**
 * Pentest M-08 note: `storageKey` is intentionally OMITTED from
 * `VoiceTrackJson`. The internal R2 key is operationally useful only to
 * the server — exposing it to clients turns the entire bucket key
 * namespace into an IDOR target the moment any endpoint accepts a
 * client-supplied key. Use `streamUrl` (built from the track id) to
 * serve audio.
 */
export interface VoiceTrackJson {
  id: string;
  stationId: string;
  recordedBy: string | null;
  durationMs: number;
  transcript: string | null;
  targetClockSlotId: string | null;
  status: string;
  aiGenerated: number | null;
  createdAt: string;
}

export interface VoiceTrackPatch {
  transcript?: string | null;
  targetClockSlotId?: string | null;
  status?: VtStatus;
  aiGenerated?: 0 | 1 | null;
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

// ---------------------------------------------------------------------------
// base64-url cursor encoding (matches Cloudflare cursor exactly).
// ---------------------------------------------------------------------------

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

export function encodeCursor(cursor: VoiceTrackKeysetCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

export function decodeCursor(
  input: string | undefined | null,
): VoiceTrackKeysetCursor | null {
  if (!input) return null;
  try {
    const json = fromBase64Url(input);
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { lastCreatedAt?: unknown }).lastCreatedAt ===
        'string' &&
      typeof (parsed as { lastId?: unknown }).lastId === 'string'
    ) {
      return parsed as VoiceTrackKeysetCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safe key-segment pattern (Pentest L-03). `stationId` and `trackId` are
 * interpolated straight into the object-store path, so they must not contain
 * path separators (`/`, `\`), traversal sequences (`..`), or any other byte
 * that could let a caller escape the per-station prefix. Only alphanumerics,
 * dots, dashes, and underscores are permitted — a superset of the UUIDs the
 * routes actually pass, with no separator characters.
 */
const SAFE_KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;

/** A segment that is nothing but dots (`.`, `..`, `...`) is a traversal token. */
const DOT_ONLY_SEGMENT = /^\.+$/;

function isSafeKeySegment(value: string): boolean {
  return SAFE_KEY_SEGMENT.test(value) && !DOT_ONLY_SEGMENT.test(value);
}

/**
 * R2 key generator for voice track audio. Keys live under a per-station
 * prefix so a single object-store glob can sweep a station's audio on
 * tenant offboarding.
 *
 * Pentest L-03: validates `stationId` and `trackId` against `SAFE_KEY_SEGMENT`
 * to prevent path traversal into another tenant's object namespace.
 */
export function generateStorageKey(
  stationId: string,
  trackId: string,
  extension = 'mp3',
): string {
  if (!stationId) throw new Error('stationId is required');
  if (!trackId) throw new Error('trackId is required');
  if (!isSafeKeySegment(stationId)) {
    throw new Error(
      'stationId contains characters not allowed in a storage key',
    );
  }
  if (!isSafeKeySegment(trackId)) {
    throw new Error(
      'trackId contains characters not allowed in a storage key',
    );
  }
  const ext = (extension || 'mp3').replace(/^\.+/, '') || 'mp3';
  return `stations/${stationId}/voice-tracks/${trackId}.${ext}`;
}

// ---------------------------------------------------------------------------
// Row → JSON projection (keeps the response shape byte-identical to
// Cloudflare's `rowToJson`).
// ---------------------------------------------------------------------------

interface VoiceTrackSelectRow {
  id: string;
  stationId: string;
  recordedBy: string | null;
  storageKey: string;
  durationMs: number;
  transcript: string | null;
  targetClockSlotId: string | null;
  status: string;
  aiGenerated: number | null;
  createdAt: string;
}

function projection() {
  return {
    id: voiceTracks.id,
    stationId: voiceTracks.stationId,
    recordedBy: voiceTracks.recordedBy,
    storageKey: voiceTracks.storageKey,
    durationMs: voiceTracks.durationMs,
    transcript: voiceTracks.transcript,
    targetClockSlotId: voiceTracks.targetClockSlotId,
    status: voiceTracks.status,
    aiGenerated: voiceTracks.aiGenerated,
    createdAt: voiceTracks.createdAt,
  };
}

export function rowToJson(row: VoiceTrackSelectRow): VoiceTrackJson {
  return {
    id: row.id,
    stationId: row.stationId,
    recordedBy: row.recordedBy,
    // Pentest M-08: storageKey is internal — never serialize to clients.
    durationMs: row.durationMs,
    transcript: row.transcript,
    targetClockSlotId: row.targetClockSlotId,
    status: row.status,
    aiGenerated: row.aiGenerated,
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Query helpers — Drizzle-flavoured replacements for the Cloudflare builders.
// ---------------------------------------------------------------------------

export async function listVoiceTracks(
  db: DbClient,
  params: ListVoiceTracksParams,
): Promise<VoiceTrackSelectRow[]> {
  if (!params.stationId) throw new Error('stationId is required');
  if (params.status !== undefined && !isAllowedStatus(params.status)) {
    throw new Error(`status must be one of ${VT_STATUSES.join(', ')}`);
  }
  const limit = clampLimit(params.limit, MAX_LIMIT, DEFAULT_LIMIT);

  const conditions = [eq(voiceTracks.stationId, params.stationId)];
  if (params.status) conditions.push(eq(voiceTracks.status, params.status));
  if (params.targetClockSlotId) {
    conditions.push(
      eq(voiceTracks.targetClockSlotId, params.targetClockSlotId),
    );
  }
  if (params.cursor) {
    // Keyset cursor: (created_at, id) < (?, ?). Emulate the lexicographic
    // tuple comparison so we stay strictly forward-paginating.
    conditions.push(
      or(
        lt(voiceTracks.createdAt, params.cursor.lastCreatedAt),
        and(
          eq(voiceTracks.createdAt, params.cursor.lastCreatedAt),
          lt(voiceTracks.id, params.cursor.lastId),
        ),
      )!,
    );
  }

  return db
    .select(projection())
    .from(voiceTracks)
    .where(and(...conditions))
    .orderBy(desc(voiceTracks.createdAt), desc(voiceTracks.id))
    .limit(limit);
}

export async function findVoiceTrackById(
  db: DbClient,
  stationId: string,
  id: string,
): Promise<VoiceTrackSelectRow | null> {
  if (!stationId) throw new Error('stationId is required');
  if (!id) throw new Error('id is required');
  const rows = await db
    .select(projection())
    .from(voiceTracks)
    .where(and(eq(voiceTracks.stationId, stationId), eq(voiceTracks.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface VoiceTrackInsertParams {
  id: string;
  stationId: string;
  recordedBy: string | null;
  storageKey: string;
  durationMs: number;
  transcript?: string | null;
  targetClockSlotId?: string | null;
  status?: VtStatus;
  aiGenerated?: 0 | 1;
  /** Optional timestamp override (tests). Defaults to `now() in UTC`. */
  createdAt?: string;
}

export async function insertVoiceTrack(
  db: DbClient,
  params: VoiceTrackInsertParams,
): Promise<void> {
  if (!params.id) throw new Error('id is required');
  if (!params.stationId) throw new Error('stationId is required');
  if (!params.storageKey) throw new Error('storageKey is required');
  if (
    typeof params.durationMs !== 'number' ||
    !Number.isFinite(params.durationMs) ||
    params.durationMs < 0
  ) {
    throw new Error('durationMs must be a non-negative number');
  }
  const status = (params.status ?? 'draft') as VtStatus;
  if (!isAllowedStatus(status)) {
    throw new Error(`status must be one of ${VT_STATUSES.join(', ')}`);
  }

  await db.insert(voiceTracks).values({
    id: params.id,
    stationId: params.stationId,
    recordedBy: params.recordedBy,
    storageKey: params.storageKey,
    durationMs: Math.floor(params.durationMs),
    transcript: params.transcript ?? null,
    targetClockSlotId: params.targetClockSlotId ?? null,
    status,
    aiGenerated: params.aiGenerated ?? 0,
    createdAt: params.createdAt ?? new Date().toISOString(),
  });
}

export async function updateVoiceTrack(
  db: DbClient,
  stationId: string,
  id: string,
  patch: VoiceTrackPatch,
): Promise<void> {
  if (!stationId) throw new Error('stationId is required');
  if (!id) throw new Error('id is required');

  const set: Record<string, unknown> = {};
  if (patch.transcript !== undefined) set.transcript = patch.transcript;
  if (patch.targetClockSlotId !== undefined) {
    set.targetClockSlotId = patch.targetClockSlotId;
  }
  if (patch.status !== undefined) {
    if (!isAllowedStatus(patch.status)) {
      throw new Error(`status must be one of ${VT_STATUSES.join(', ')}`);
    }
    set.status = patch.status;
  }
  if (patch.aiGenerated !== undefined) set.aiGenerated = patch.aiGenerated;

  if (Object.keys(set).length === 0) throw new Error('no fields to update');

  await db
    .update(voiceTracks)
    .set(set)
    .where(and(eq(voiceTracks.stationId, stationId), eq(voiceTracks.id, id)));
}

export async function deleteVoiceTrack(
  db: DbClient,
  stationId: string,
  id: string,
): Promise<void> {
  if (!stationId) throw new Error('stationId is required');
  if (!id) throw new Error('id is required');
  await db
    .delete(voiceTracks)
    .where(and(eq(voiceTracks.stationId, stationId), eq(voiceTracks.id, id)));
}

// Silence the unused sql tag while keeping the import shape stable for future
// raw helpers (e.g. window functions or RAW upserts).
void sql;
