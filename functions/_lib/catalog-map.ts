/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from './env';

// ---------------------------------------------------------------------------
// Legacy `tracks` table shape — kept so older endpoints / scripts still build.
// New radio endpoints below operate on `radio_tracks`.
// ---------------------------------------------------------------------------
export type TrackRow = {
  id: string;
  title: string;
  artist_id: string;
  artist_name: string;
  album_id: string;
  album_title: string;
  duration: number;
  artwork: string;
  source: string;
  genre: string;
  year: number;
  track_number: number;
  date_added: string | null;
  media_r2_key: string | null;
  content_hash: string | null;
};

/** JSON shape aligned with src/lib/types Track (subset + server fields). */
export function trackRowToJson(row: TrackRow, request: Request): Record<string, unknown> {
  const origin = new URL(request.url).origin;
  const base: Record<string, unknown> = {
    id: row.id,
    title: row.title,
    artist: row.artist_name,
    artistId: row.artist_id,
    album: row.album_title,
    albumId: row.album_id,
    duration: row.duration,
    artwork: row.artwork,
    source: row.source,
    genre: row.genre,
    year: row.year,
    trackNumber: row.track_number,
  };
  if (row.date_added) base.dateAdded = row.date_added;
  if (row.media_r2_key) {
    base.cloudKey = row.media_r2_key;
    base.mediaUrl = `${origin}/api/tracks/${encodeURIComponent(row.id)}/stream`;
  }
  if (row.content_hash) base.contentHash = row.content_hash;
  return base;
}

export async function selectAllTracks(db: D1Database, request: Request): Promise<TrackRow[]> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.title, t.artist_id, a.name AS artist_name, t.album_id, b.title AS album_title,
              t.duration, t.artwork, t.source, t.genre, t.year, t.track_number, t.date_added,
              t.media_r2_key, t.content_hash
       FROM tracks t
       INNER JOIN artists a ON a.id = t.artist_id
       INNER JOIN albums b ON b.id = t.album_id
       ORDER BY b.id, t.track_number, t.id`,
    )
    .all<TrackRow>();
  return (results ?? []).map((r) => ({
    ...r,
    duration: Number(r.duration),
    year: Number(r.year),
    track_number: Number(r.track_number),
  }));
}

export function getDb(env: SonicBloomEnv): D1Database | null {
  return env.DB ?? null;
}

export function getR2(env: SonicBloomEnv): R2Bucket | null {
  return env.MEDIA_BUCKET ?? null;
}

// ---------------------------------------------------------------------------
// Radio (Phase 1) — radio_tracks row shape and mapping to the public API
// shape consumed by `src/lib/types.ts` (`Track`, `Album`, `Artist`, `Playlist`).
// ---------------------------------------------------------------------------

/** Subset of columns selected by `buildTracksQuery` (and *DetailQuery siblings). */
export interface RadioTrackRow {
  id: string;
  station_id: string;
  category_id: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  genre: string | null;
  bpm: number | null;
  music_key: string | null;
  energy: number | null;
  era_year: number | null;
  language: string | null;
  duration_ms: number;
  cue_in_ms: number | null;
  cue_out_ms: number | null;
  intro_ms: number | null;
  outro_ms: number | null;
  mix_point_ms: number | null;
  loudness_lufs: number | null;
  file_type: string | null;
  content_hash: string | null;
  storage_key: string;
  custom_f1: string | null;
  custom_f2: string | null;
  custom_f3: string | null;
  custom_f4: string | null;
  custom_f5: string | null;
  rating: number | null;
  play_count: number | null;
  last_played_at: string | null;
  date_added: string;
}

/**
 * Deterministic, URL-safe slug used to derive stable Album/Artist ids from
 * their free-text radio_tracks columns. Identical input → identical output.
 */
export function deriveCatalogId(prefix: string, value: string | null | undefined): string {
  const raw = (value ?? '').toString().trim();
  if (!raw) return `${prefix}-unknown`;
  const slug = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug ? `${prefix}-${slug}` : `${prefix}-unknown`;
}

/**
 * Map a radio_tracks row to the UI Track shape. Preserves the existing keys
 * consumed by `src/lib/types.ts` so the front-end keeps working.
 */
export function radioTrackToJson(
  row: RadioTrackRow,
  request: Request,
): Record<string, unknown> {
  const origin = new URL(request.url).origin;
  const albumTitle = row.album ?? '';
  const artistName = row.artist ?? '';
  const albumId = deriveCatalogId('album', albumTitle);
  const artistId = deriveCatalogId('artist', artistName);
  const duration = Math.max(0, Math.round((row.duration_ms ?? 0) / 1000));

  const json: Record<string, unknown> = {
    id: row.id,
    title: row.title,
    artist: artistName,
    artistId,
    album: albumTitle,
    albumId,
    categoryId: row.category_id,
    duration,
    artwork: '',
    source: 'cloud',
    genre: row.genre ?? '',
    year: row.era_year ?? 0,
    trackNumber: 0,
    dateAdded: row.date_added,
  };
  if (row.content_hash) json.contentHash = row.content_hash;
  if (row.storage_key) {
    json.cloudKey = row.storage_key;
    json.mediaUrl = `${origin}/api/tracks/${encodeURIComponent(row.id)}/stream`;
  }
  return json;
}

export interface DerivedAlbumRow {
  album_name: string | null;
  artist_name: string | null;
  track_count: number | null;
  year: number | null;
  genre: string | null;
  first_added: string | null;
  last_added: string | null;
}

export function radioAlbumRowToJson(row: DerivedAlbumRow): Record<string, unknown> {
  const title = row.album_name ?? '';
  const artistName = row.artist_name ?? '';
  return {
    id: deriveCatalogId('album', title),
    title,
    artist: artistName,
    artistId: deriveCatalogId('artist', artistName),
    artwork: '',
    year: row.year ?? 0,
    genre: row.genre ?? '',
    source: 'cloud',
    trackCount: Number(row.track_count ?? 0),
    dateAdded: row.last_added ?? row.first_added ?? undefined,
    tracks: [],
  };
}

export interface DerivedArtistRow {
  artist_name: string | null;
  track_count: number | null;
  album_count: number | null;
  genre: string | null;
}

export function radioArtistRowToJson(row: DerivedArtistRow): Record<string, unknown> {
  const name = row.artist_name ?? '';
  const genre = row.genre ?? '';
  return {
    id: deriveCatalogId('artist', name),
    name,
    artwork: '',
    genres: genre ? [genre] : [],
    albumCount: Number(row.album_count ?? 0),
    trackCount: Number(row.track_count ?? 0),
  };
}
