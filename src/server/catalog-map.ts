/**
 * Row-to-JSON mappers for the station-scoped catalog endpoints.
 *
 * Next-side port of `functions/_lib/catalog-map.ts`, scoped to the radio
 * Phase 1 schema only (legacy `tracks` table mappers stay in the Cloudflare
 * tree). The output shape matches the legacy helper byte-for-byte so the
 * front-end (`src/lib/types.ts` consumers) does not need to branch on stack.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β2.
 */

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
 * the free-text radio_tracks columns. Same input → same output across stacks.
 */
export function deriveCatalogId(
  prefix: string,
  value: string | null | undefined,
): string {
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
 * Map a `radio_tracks` row (snake_case from raw SQL) to the UI Track shape.
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
