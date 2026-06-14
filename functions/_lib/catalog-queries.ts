/// <reference types="@cloudflare/workers-types" />

/**
 * Pure SQL builders for the station-scoped catalog endpoints.
 *
 * These functions are intentionally framework-free so they can be
 * unit-tested without spinning up D1. Every builder enforces
 * `WHERE station_id = ?` as its first predicate, eliminating the
 * possibility of accidental cross-station leakage at the call site.
 */

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface KeysetCursor {
  lastDate: string;
  lastId: string;
}

export interface CatalogFilters {
  /** Restrict to a single category (file type cluster). */
  categoryId?: string;
  /** Restrict to a single file_type (e.g. 'music', 'sweeper'). */
  fileType?: string;
  /** Inclusive lower bound on bpm. */
  minBpm?: number;
  /** Inclusive upper bound on bpm. */
  maxBpm?: number;
  /** Fuzzy search applied to title + artist (and album for albums query). */
  search?: string;
}

export interface ListParams {
  stationId: string;
  cursor?: KeysetCursor;
  limit: number;
  filters?: CatalogFilters;
}

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

export function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  if (value > MAX_LIMIT) return MAX_LIMIT;
  return Math.floor(value);
}

function toBase64Url(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64url');
  }
  // Worker fallback: btoa returns base64, then convert to base64url
  const b64 = btoa(input);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'base64url').toString('utf8');
  }
  // Worker fallback
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return atob(b64);
}

export function encodeCursor(cursor: KeysetCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

export function decodeCursor(input: string | undefined | null): KeysetCursor | null {
  if (!input) return null;
  try {
    const json = fromBase64Url(input);
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { lastDate?: unknown }).lastDate === 'string' &&
      typeof (parsed as { lastId?: unknown }).lastId === 'string'
    ) {
      return parsed as KeysetCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function requireStationId(stationId: string): void {
  if (!stationId) throw new Error('stationId is required');
}

function applyFilters(
  filters: CatalogFilters | undefined,
  searchColumns: string[],
): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!filters) return { clauses, params };
  if (filters.categoryId) {
    clauses.push('category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.fileType) {
    clauses.push('file_type = ?');
    params.push(filters.fileType);
  }
  if (typeof filters.minBpm === 'number') {
    clauses.push('bpm >= ?');
    params.push(filters.minBpm);
  }
  if (typeof filters.maxBpm === 'number') {
    clauses.push('bpm <= ?');
    params.push(filters.maxBpm);
  }
  if (filters.search) {
    const like = `%${filters.search}%`;
    if (searchColumns.length === 0) {
      clauses.push('title LIKE ?');
      params.push(like);
    } else {
      clauses.push(`(${searchColumns.map((c) => `${c} LIKE ?`).join(' OR ')})`);
      for (let i = 0; i < searchColumns.length; i++) params.push(like);
    }
  }
  return { clauses, params };
}

const TRACK_COLUMNS = `id, station_id, category_id, title, artist, album, genre, bpm, music_key, energy,
  era_year, language, duration_ms, cue_in_ms, cue_out_ms, intro_ms, outro_ms, mix_point_ms,
  loudness_lufs, file_type, content_hash, storage_key, custom_f1, custom_f2, custom_f3, custom_f4,
  custom_f5, rating, play_count, last_played_at, date_added`;

export function buildTracksQuery(p: ListParams): BuiltQuery {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit);
  const params: unknown[] = [p.stationId];
  const where: string[] = ['station_id = ?'];

  const f = applyFilters(p.filters, ['title', 'artist']);
  where.push(...f.clauses);
  params.push(...f.params);

  if (p.cursor) {
    where.push('(date_added, id) < (?, ?)');
    params.push(p.cursor.lastDate, p.cursor.lastId);
  }

  const sql = `SELECT ${TRACK_COLUMNS}
    FROM radio_tracks
    WHERE ${where.join(' AND ')}
    ORDER BY date_added DESC, id DESC
    LIMIT ${limit}`;
  return { sql, params };
}

export function buildAlbumsQuery(p: ListParams): BuiltQuery {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit);
  const params: unknown[] = [p.stationId];
  const where: string[] = ['station_id = ?', "album IS NOT NULL", "album != ''"];

  const f = applyFilters(p.filters, ['album', 'artist']);
  where.push(...f.clauses);
  params.push(...f.params);

  const sql = `SELECT
      album AS album_name,
      MAX(artist) AS artist_name,
      COUNT(*) AS track_count,
      MIN(era_year) AS year,
      MAX(genre) AS genre,
      MIN(date_added) AS first_added,
      MAX(date_added) AS last_added
    FROM radio_tracks
    WHERE ${where.join(' AND ')}
    GROUP BY album
    ORDER BY album ASC
    LIMIT ${limit}`;
  return { sql, params };
}

export function buildArtistsQuery(p: ListParams): BuiltQuery {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit);
  const params: unknown[] = [p.stationId];
  const where: string[] = ['station_id = ?', 'artist IS NOT NULL', "artist != ''"];

  const f = applyFilters(p.filters, ['artist']);
  where.push(...f.clauses);
  params.push(...f.params);

  const sql = `SELECT
      artist AS artist_name,
      COUNT(*) AS track_count,
      COUNT(DISTINCT album) AS album_count,
      MAX(genre) AS genre
    FROM radio_tracks
    WHERE ${where.join(' AND ')}
    GROUP BY artist
    ORDER BY artist ASC
    LIMIT ${limit}`;
  return { sql, params };
}

/**
 * Phase 1 radio schema does not have a `playlists` table. We return a stable
 * "empty result" query that is still station-scoped so the endpoint shape
 * and security stay consistent with the rest of the catalog.
 */
export function buildPlaylistsQuery(p: ListParams): BuiltQuery {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit);
  // Use radio_tracks to honour station_id but return zero rows.
  const sql = `SELECT id, title FROM radio_tracks WHERE station_id = ? AND 1 = 0 LIMIT ${limit}`;
  return { sql, params: [p.stationId] };
}

export function buildTrackByIdQuery(input: { stationId: string; id: string }): BuiltQuery {
  requireStationId(input.stationId);
  const sql = `SELECT ${TRACK_COLUMNS} FROM radio_tracks WHERE station_id = ? AND id = ? LIMIT 1`;
  return { sql, params: [input.stationId, input.id] };
}

/**
 * Returns ALL tracks for the given derived album group key (case-sensitive match
 * against the `album` column) scoped to a station.
 */
export function buildAlbumDetailQuery(input: { stationId: string; albumKey: string }): BuiltQuery {
  requireStationId(input.stationId);
  const sql = `SELECT ${TRACK_COLUMNS}
    FROM radio_tracks
    WHERE station_id = ? AND album = ?
    ORDER BY date_added DESC, id DESC
    LIMIT ${MAX_LIMIT}`;
  return { sql, params: [input.stationId, input.albumKey] };
}

/**
 * Returns ALL tracks for the given artist key scoped to a station.
 */
export function buildArtistDetailQuery(input: {
  stationId: string;
  artistKey: string;
}): BuiltQuery {
  requireStationId(input.stationId);
  const sql = `SELECT ${TRACK_COLUMNS}
    FROM radio_tracks
    WHERE station_id = ? AND artist = ?
    ORDER BY date_added DESC, id DESC
    LIMIT ${MAX_LIMIT}`;
  return { sql, params: [input.stationId, input.artistKey] };
}
