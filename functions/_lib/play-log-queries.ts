/// <reference types="@cloudflare/workers-types" />

/**
 * Pure SQL builders for the station-scoped play_log endpoints.
 *
 * Mirrors the conventions of catalog-queries.ts:
 * - station-scoped: every builder requires a stationId and uses it as the
 *   first WHERE predicate.
 * - parametric only — user data never interpolated into SQL strings.
 * - framework-free so it can be unit-tested without spinning up D1.
 *
 * The `play_log.source` column has a CHECK constraint defined in migration
 * 0004 limiting values to:
 *   'automation' | 'manual' | 'live_dj' | 'voice_track' | 'cart' | 'spot'
 * `ALLOWED_SOURCES` mirrors that constraint so the API layer can validate
 * before reaching D1.
 */

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

/**
 * Mirrors the CHECK constraint in migrations/0004_radio_schema.sql:
 *   CHECK (source IN ('automation','manual','live_dj','voice_track','cart','spot'))
 * If the constraint is extended later (e.g. 'now_playing','auto_recognition'),
 * update this array and migrations/0004 together.
 */
export const ALLOWED_SOURCES = [
  'automation',
  'manual',
  'live_dj',
  'voice_track',
  'cart',
  'spot',
] as const;
export type PlayLogSource = (typeof ALLOWED_SOURCES)[number];

export function isAllowedSource(value: unknown): value is PlayLogSource {
  return typeof value === 'string' && (ALLOWED_SOURCES as readonly string[]).includes(value);
}

export interface PlayLogEntry {
  id: string;
  stationId: string;
  trackId?: string | null;
  titleSnapshot: string;
  artistSnapshot?: string | null;
  playedAt?: string; // ISO 8601 — defaults to datetime('now') in SQL.
  durationPlayedMs?: number | null;
  source: PlayLogSource | string;
  isrc?: string | null;
  iswc?: string | null;
}

export interface PlayLogKeysetCursor {
  lastPlayedAt: string;
  lastId: string;
}

export interface ListPlayLogParams {
  stationId: string;
  from?: string; // ISO 8601, inclusive lower bound
  to?: string; // ISO 8601, exclusive upper bound
  source?: string;
  trackId?: string;
  cursor?: PlayLogKeysetCursor;
  limit: number;
}

export interface AggregatePlayLogParams {
  stationId: string;
  from?: string;
  to?: string;
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

export function encodeCursor(cursor: PlayLogKeysetCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

export function decodeCursor(input: string | undefined | null): PlayLogKeysetCursor | null {
  if (!input) return null;
  try {
    const json = fromBase64Url(input);
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { lastPlayedAt?: unknown }).lastPlayedAt === 'string' &&
      typeof (parsed as { lastId?: unknown }).lastId === 'string'
    ) {
      return parsed as PlayLogKeysetCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function requireStationId(stationId: string): void {
  if (!stationId) throw new Error('stationId is required');
}

const PLAY_LOG_COLUMNS =
  'id, station_id, track_id, title_snapshot, artist_snapshot, played_at, duration_played_ms, source, isrc, iswc';

export function buildPlayLogListQuery(p: ListPlayLogParams): BuiltQuery {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit, MAX_LIMIT, DEFAULT_LIMIT);

  const where: string[] = ['station_id = ?'];
  const params: unknown[] = [p.stationId];

  if (p.from) {
    where.push('played_at >= ?');
    params.push(p.from);
  }
  if (p.to) {
    where.push('played_at < ?');
    params.push(p.to);
  }
  if (p.source) {
    where.push('source = ?');
    params.push(p.source);
  }
  if (p.trackId) {
    where.push('track_id = ?');
    params.push(p.trackId);
  }
  if (p.cursor) {
    where.push('(played_at, id) < (?, ?)');
    params.push(p.cursor.lastPlayedAt, p.cursor.lastId);
  }

  const sql = `SELECT ${PLAY_LOG_COLUMNS}
    FROM play_log
    WHERE ${where.join(' AND ')}
    ORDER BY played_at DESC, id DESC
    LIMIT ${limit}`;

  return { sql, params };
}

export function buildPlayLogInsert(entry: PlayLogEntry): BuiltQuery {
  if (!entry.id) throw new Error('id is required');
  requireStationId(entry.stationId);
  if (!entry.titleSnapshot || !entry.titleSnapshot.trim()) {
    throw new Error('titleSnapshot is required');
  }
  if (!isAllowedSource(entry.source)) {
    throw new Error(
      `source must be one of ${ALLOWED_SOURCES.join(', ')} — got ${String(entry.source)}`,
    );
  }

  // played_at: if explicit value provided, bind it; otherwise let SQL default to datetime('now').
  const playedAtIsExplicit = typeof entry.playedAt === 'string' && entry.playedAt.length > 0;
  const playedAtPlaceholder = playedAtIsExplicit ? '?' : "datetime('now')";

  const sql = `INSERT INTO play_log
    (id, station_id, track_id, title_snapshot, artist_snapshot, played_at, duration_played_ms, source, isrc, iswc)
    VALUES (?, ?, ?, ?, ?, ${playedAtPlaceholder}, ?, ?, ?, ?)`;

  const params: unknown[] = [
    entry.id,
    entry.stationId,
    entry.trackId ?? null,
    entry.titleSnapshot,
    entry.artistSnapshot ?? null,
  ];
  if (playedAtIsExplicit) {
    params.push(entry.playedAt as string);
  }
  params.push(
    entry.durationPlayedMs ?? null,
    entry.source,
    entry.isrc ?? null,
    entry.iswc ?? null,
  );

  return { sql, params };
}

export function buildPlayLogAggregateQuery(p: AggregatePlayLogParams): BuiltQuery {
  requireStationId(p.stationId);
  const where: string[] = ['station_id = ?'];
  const params: unknown[] = [p.stationId];

  if (p.from) {
    where.push('played_at >= ?');
    params.push(p.from);
  }
  if (p.to) {
    where.push('played_at < ?');
    params.push(p.to);
  }

  const sql = `SELECT title_snapshot, artist_snapshot, COUNT(*) AS plays
    FROM play_log
    WHERE ${where.join(' AND ')}
    GROUP BY title_snapshot, artist_snapshot
    ORDER BY plays DESC, title_snapshot ASC
    LIMIT ${MAX_LIMIT}`;

  return { sql, params };
}
