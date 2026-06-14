/**
 * Pure SQL builders for the station-scoped catalog endpoints.
 *
 * Next-side port of `functions/_lib/catalog-queries.ts`. The Cloudflare
 * helper emits `?`-style placeholders for D1; this version returns
 * Drizzle `sql` templates so the same queries run against Postgres via
 * `db.execute(sql)`. Every builder enforces `WHERE station_id = ?` as
 * its first predicate, eliminating cross-station leakage at the call site.
 *
 * Cursor encoding mirrors the legacy helper byte-for-byte so clients can
 * pass cursors freely between the Cloudflare and Railway stacks during
 * the dual-stack window.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β2.
 */

import { sql, type SQL } from 'drizzle-orm';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export interface KeysetCursor {
  lastDate: string;
  lastId: string;
}

export interface CatalogFilters {
  categoryId?: string;
  fileType?: string;
  minBpm?: number;
  maxBpm?: number;
  search?: string;
}

export interface ListParams {
  stationId: string;
  cursor?: KeysetCursor;
  limit: number;
  filters?: CatalogFilters;
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

/**
 * Build the SQL fragments produced by the legacy `applyFilters` helper.
 * Returns an array of `SQL` chunks the caller can join with ` AND `.
 */
function filterFragments(
  filters: CatalogFilters | undefined,
  searchColumns: string[],
): SQL[] {
  const chunks: SQL[] = [];
  if (!filters) return chunks;
  if (filters.categoryId) {
    chunks.push(sql`category_id = ${filters.categoryId}`);
  }
  if (filters.fileType) {
    chunks.push(sql`file_type = ${filters.fileType}`);
  }
  if (typeof filters.minBpm === 'number') {
    chunks.push(sql`bpm >= ${filters.minBpm}`);
  }
  if (typeof filters.maxBpm === 'number') {
    chunks.push(sql`bpm <= ${filters.maxBpm}`);
  }
  if (filters.search) {
    const like = `%${filters.search}%`;
    if (searchColumns.length === 0) {
      chunks.push(sql`title LIKE ${like}`);
    } else {
      // Build an OR fan-out: (col1 LIKE ? OR col2 LIKE ? ...)
      const fragments: SQL[] = searchColumns.map(
        (col) => sql`${sql.raw(col)} LIKE ${like}`,
      );
      chunks.push(sql`(${sql.join(fragments, sql` OR `)})`);
    }
  }
  return chunks;
}

function joinAnd(chunks: SQL[]): SQL {
  return sql.join(chunks, sql` AND `);
}

const TRACK_COLUMNS_SQL = sql`id, station_id, category_id, title, artist, album, genre, bpm, music_key, energy,
  era_year, language, duration_ms, cue_in_ms, cue_out_ms, intro_ms, outro_ms, mix_point_ms,
  loudness_lufs, file_type, content_hash, storage_key, custom_f1, custom_f2, custom_f3, custom_f4,
  custom_f5, rating, play_count, last_played_at, date_added`;

/**
 * Tracks list query — keyset paginated, station-scoped, optional filters.
 *
 * The Cloudflare D1 helper exposes `{ sql, params }`; this version returns
 * a Drizzle `SQL` so the route can `db.execute(sql)` directly. `effectiveLimit`
 * is included so callers can apply the clamp identically to the legacy code
 * without re-parsing the SQL.
 */
export function buildTracksQuery(p: ListParams): { sql: SQL; effectiveLimit: number } {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit);

  const where: SQL[] = [sql`station_id = ${p.stationId}`];
  where.push(...filterFragments(p.filters, ['title', 'artist']));

  if (p.cursor) {
    where.push(sql`(date_added, id) < (${p.cursor.lastDate}, ${p.cursor.lastId})`);
  }

  const query = sql`SELECT ${TRACK_COLUMNS_SQL}
    FROM radio_tracks
    WHERE ${joinAnd(where)}
    ORDER BY date_added DESC, id DESC
    LIMIT ${sql.raw(String(limit))}`;
  return { sql: query, effectiveLimit: limit };
}

export function buildAlbumsQuery(p: ListParams): { sql: SQL; effectiveLimit: number } {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit);

  const where: SQL[] = [
    sql`station_id = ${p.stationId}`,
    sql`album IS NOT NULL`,
    sql`album != ''`,
  ];
  where.push(...filterFragments(p.filters, ['album', 'artist']));

  const query = sql`SELECT
      album AS album_name,
      MAX(artist) AS artist_name,
      COUNT(*) AS track_count,
      MIN(era_year) AS year,
      MAX(genre) AS genre,
      MIN(date_added) AS first_added,
      MAX(date_added) AS last_added
    FROM radio_tracks
    WHERE ${joinAnd(where)}
    GROUP BY album
    ORDER BY album ASC
    LIMIT ${sql.raw(String(limit))}`;
  return { sql: query, effectiveLimit: limit };
}

export function buildArtistsQuery(p: ListParams): { sql: SQL; effectiveLimit: number } {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit);

  const where: SQL[] = [
    sql`station_id = ${p.stationId}`,
    sql`artist IS NOT NULL`,
    sql`artist != ''`,
  ];
  where.push(...filterFragments(p.filters, ['artist']));

  const query = sql`SELECT
      artist AS artist_name,
      COUNT(*) AS track_count,
      COUNT(DISTINCT album) AS album_count,
      MAX(genre) AS genre
    FROM radio_tracks
    WHERE ${joinAnd(where)}
    GROUP BY artist
    ORDER BY artist ASC
    LIMIT ${sql.raw(String(limit))}`;
  return { sql: query, effectiveLimit: limit };
}

/**
 * Phase 1 schema has no `playlists` table — this builder is retained as a
 * no-op so the route surface stays stable. Returns zero rows, station-scoped.
 */
export function buildPlaylistsQuery(p: ListParams): { sql: SQL; effectiveLimit: number } {
  requireStationId(p.stationId);
  const limit = clampLimit(p.limit);
  const query = sql`SELECT id, title FROM radio_tracks
    WHERE station_id = ${p.stationId} AND 1 = 0
    LIMIT ${sql.raw(String(limit))}`;
  return { sql: query, effectiveLimit: limit };
}

export function buildAlbumDetailQuery(input: { stationId: string; albumKey: string }): {
  sql: SQL;
} {
  requireStationId(input.stationId);
  const query = sql`SELECT ${TRACK_COLUMNS_SQL}
    FROM radio_tracks
    WHERE station_id = ${input.stationId} AND album = ${input.albumKey}
    ORDER BY date_added DESC, id DESC
    LIMIT ${sql.raw(String(MAX_LIMIT))}`;
  return { sql: query };
}

export function buildArtistDetailQuery(input: { stationId: string; artistKey: string }): {
  sql: SQL;
} {
  requireStationId(input.stationId);
  const query = sql`SELECT ${TRACK_COLUMNS_SQL}
    FROM radio_tracks
    WHERE station_id = ${input.stationId} AND artist = ${input.artistKey}
    ORDER BY date_added DESC, id DESC
    LIMIT ${sql.raw(String(MAX_LIMIT))}`;
  return { sql: query };
}
