/**
 * Drizzle/Postgres helpers for the station-scoped /api/play-log endpoint —
 * Next-side port of `functions/_lib/play-log-queries.ts`.
 *
 *   - station-scoped: stationId is the first WHERE predicate, never bypassed.
 *   - keyset pagination on `(played_at, id) DESC` — matches the
 *     `idx_play_log_station_played_at` index.
 *   - aggregate flavour groups by (title_snapshot, artist_snapshot).
 *   - INSERT goes through Drizzle's typed builder so the schema CHECK is
 *     re-enforced at the table level.
 *
 * ALLOWED_SOURCES intentionally mirrors the legacy Cloudflare list so the
 * Zod validation contract on the HTTP boundary stays identical during the
 * dual-stack window. (The CHECK constraint in 0006 also accepts
 * `'now_playing'` and `'auto_recognition'`, but those are written by the
 * recognition pipeline directly, not by the REST POST surface.)
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β6.
 */

import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';

import type { DbClient } from '@/db/client';
import { playLog } from '@/db/schema';

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 1000;

/**
 * Subset of `play_log.source` CHECK accepted via the REST POST surface.
 * Recognition / now-playing writes happen server-side and don't go through
 * this validator.
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
  return (
    typeof value === 'string' &&
    (ALLOWED_SOURCES as readonly string[]).includes(value)
  );
}

export interface PlayLogKeysetCursor {
  lastPlayedAt: string;
  lastId: string;
}

export interface PlayLogRow {
  id: string;
  stationId: string;
  trackId: string | null;
  titleSnapshot: string;
  artistSnapshot: string | null;
  playedAt: string;
  durationPlayedMs: number | null;
  source: string;
  isrc: string | null;
  iswc: string | null;
}

export interface PlayLogAggregateRow {
  title: string;
  artist: string | null;
  plays: number;
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

export interface InsertPlayLogParams {
  /** Optional override (tests). Defaults to `crypto.randomUUID()`. */
  id?: string;
  stationId: string;
  trackId?: string;
  titleSnapshot: string;
  artistSnapshot?: string;
  /** ISO 8601 — if omitted, the server-side `now()` ISO string is used. */
  playedAt?: string;
  durationPlayedMs?: number;
  source: PlayLogSource | string;
  isrc?: string;
  iswc?: string;
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

export function encodeCursor(cursor: PlayLogKeysetCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

export function decodeCursor(
  input: string | undefined | null,
): PlayLogKeysetCursor | null {
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

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function mapListRow(row: Record<string, unknown>): PlayLogRow {
  return {
    id: String(row.id),
    stationId: String(row.station_id),
    trackId:
      row.track_id === null || row.track_id === undefined
        ? null
        : String(row.track_id),
    titleSnapshot: String(row.title_snapshot),
    artistSnapshot:
      row.artist_snapshot === null || row.artist_snapshot === undefined
        ? null
        : String(row.artist_snapshot),
    playedAt: String(row.played_at),
    durationPlayedMs: toNullableNumber(row.duration_played_ms),
    source: String(row.source),
    isrc:
      row.isrc === null || row.isrc === undefined ? null : String(row.isrc),
    iswc:
      row.iswc === null || row.iswc === undefined ? null : String(row.iswc),
  };
}

/**
 * Keyset-paginated list. Newest rows first.
 */
export async function queryPlayLogList(
  db: DbClient,
  p: ListPlayLogParams,
): Promise<PlayLogRow[]> {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit, MAX_LIMIT, DEFAULT_LIMIT);

  const parts: SQL[] = [sql`station_id = ${p.stationId}`];
  if (p.from) parts.push(sql`played_at >= ${p.from}`);
  if (p.to) parts.push(sql`played_at < ${p.to}`);
  if (p.source) parts.push(sql`source = ${p.source}`);
  if (p.trackId) parts.push(sql`track_id = ${p.trackId}`);
  if (p.cursor) {
    parts.push(
      sql`(played_at, id) < (${p.cursor.lastPlayedAt}, ${p.cursor.lastId})`,
    );
  }
  const where = sql.join(parts, sql` AND `);

  const statement = sql`SELECT
      id, station_id, track_id, title_snapshot, artist_snapshot, played_at,
      duration_played_ms, source, isrc, iswc
    FROM play_log
    WHERE ${where}
    ORDER BY played_at DESC, id DESC
    LIMIT ${limit}`;

  const rows = await execRows(db, statement);
  return rows.map(mapListRow);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Aggregate plays by (title, artist).
 */
export async function queryPlayLogAggregate(
  db: DbClient,
  p: AggregatePlayLogParams,
): Promise<PlayLogAggregateRow[]> {
  requireStationId(p.stationId);
  const parts: SQL[] = [sql`station_id = ${p.stationId}`];
  if (p.from) parts.push(sql`played_at >= ${p.from}`);
  if (p.to) parts.push(sql`played_at < ${p.to}`);
  const where = sql.join(parts, sql` AND `);

  const statement = sql`SELECT title_snapshot AS title, artist_snapshot AS artist, COUNT(*)::int AS plays
    FROM play_log
    WHERE ${where}
    GROUP BY title_snapshot, artist_snapshot
    ORDER BY plays DESC, title_snapshot ASC
    LIMIT ${MAX_LIMIT}`;

  const rows = await execRows(db, statement);
  return rows.map((r) => ({
    title: String(r.title),
    artist:
      r.artist === null || r.artist === undefined ? null : String(r.artist),
    plays: toNumber(r.plays),
  }));
}

function nowIsoText(): string {
  return new Date().toISOString();
}

/**
 * Insert one play_log row. Returns the materialised row (with defaults
 * resolved) so the endpoint can echo it back to the client.
 */
export async function insertPlayLog(
  db: DbClient,
  p: InsertPlayLogParams,
): Promise<PlayLogRow> {
  requireStationId(p.stationId);
  if (!p.titleSnapshot || !p.titleSnapshot.trim()) {
    throw new Error('titleSnapshot is required');
  }
  if (!isAllowedSource(p.source)) {
    throw new Error(
      `source must be one of ${ALLOWED_SOURCES.join(', ')} — got ${String(p.source)}`,
    );
  }

  const id = p.id ?? randomUUID();
  const playedAt = p.playedAt && p.playedAt.length > 0 ? p.playedAt : nowIsoText();

  await db.insert(playLog).values({
    id,
    stationId: p.stationId,
    trackId: p.trackId ?? null,
    titleSnapshot: p.titleSnapshot,
    artistSnapshot: p.artistSnapshot ?? null,
    playedAt,
    durationPlayedMs: p.durationPlayedMs ?? null,
    source: p.source,
    isrc: p.isrc ?? null,
    iswc: p.iswc ?? null,
  });

  return {
    id,
    stationId: p.stationId,
    trackId: p.trackId ?? null,
    titleSnapshot: p.titleSnapshot,
    artistSnapshot: p.artistSnapshot ?? null,
    playedAt,
    durationPlayedMs: p.durationPlayedMs ?? null,
    source: p.source,
    isrc: p.isrc ?? null,
    iswc: p.iswc ?? null,
  };
}
