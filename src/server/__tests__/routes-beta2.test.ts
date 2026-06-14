// @vitest-environment node

/**
 * Wave RM-β2 — Catalog Next.js Route Handlers.
 *
 * Eight handlers under `src/app/api/catalog/**` mirroring
 * `functions/api/catalog/**`. Each route enforces `requireStation` so the
 * test plan is: 1 unauthenticated path + 1 authenticated happy path + 1
 * edge case per endpoint, against a pg-mem-backed Drizzle client.
 *
 * The pg-mem harness reproduces the columns and CHECK constraints exactly,
 * so tests fail in the same way Railway will when bound to a real Postgres.
 */

import { describe, expect, test } from 'vitest';

import { getCatalogIndex } from '@/app/api/catalog/route-impl';
import { getCatalogAlbums } from '@/app/api/catalog/albums/route-impl';
import { getCatalogAlbumById } from '@/app/api/catalog/albums/[id]/route-impl';
import { getCatalogArtists } from '@/app/api/catalog/artists/route-impl';
import { getCatalogArtistById } from '@/app/api/catalog/artists/[id]/route-impl';
import { getCatalogPlaylists } from '@/app/api/catalog/playlists/route-impl';
import { getCatalogPlaylistById } from '@/app/api/catalog/playlists/[id]/route-impl';
import { getCatalogTracks } from '@/app/api/catalog/tracks/route-impl';
import {
  signSessionToken,
  sessionCookieName,
} from '@/server/auth/session-jwt';
import {
  createTestDbWithUser,
  type TestDbHandle,
  type SeededUser,
} from '@/server/test-utils/db';

const SECRET = 'beta2-test-secret';

interface AuthedFixture {
  handle: TestDbHandle;
  user: SeededUser;
  cookie: string;
}

async function makeAuthedFixture(): Promise<AuthedFixture> {
  const { handle, user } = createTestDbWithUser({
    userId: 'u-beta2',
    username: 'beta2-tester',
    stationId: 'station-beta2',
    orgId: 'org-beta2',
    role: 'admin',
  });
  const token = await signSessionToken(SECRET, {
    sub: user.userId,
    username: user.username,
  });
  return {
    handle,
    user,
    cookie: `${sessionCookieName()}=${encodeURIComponent(token)}`,
  };
}

function buildRequest(path: string, cookie?: string): Request {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  return new Request(`http://localhost${path}`, { headers });
}

interface TrackOverrides {
  id?: string;
  title?: string;
  artist?: string | null;
  album?: string | null;
  genre?: string | null;
  eraYear?: number | null;
  dateAdded?: string;
  durationMs?: number;
  storageKey?: string;
}

function pickWithNull<T>(
  overrides: TrackOverrides,
  key: keyof TrackOverrides,
  fallback: T,
): T | null {
  // Distinguish "key not provided" (use fallback) from "key = null" (keep null).
  if (key in overrides) {
    return overrides[key] as T | null;
  }
  return fallback;
}

/**
 * Seed one well-formed radio_tracks row. Honors explicit `null` overrides
 * (which `??` would otherwise replace with the fallback).
 */
function seedTrack(
  handle: TestDbHandle,
  stationId: string,
  overrides: TrackOverrides = {},
): void {
  const id = overrides.id ?? 'track-1';
  const title = overrides.title ?? 'Test Song';
  const artist = pickWithNull<string>(overrides, 'artist', 'Test Artist');
  const album = pickWithNull<string>(overrides, 'album', 'Test Album');
  const genre = pickWithNull<string>(overrides, 'genre', 'pop');
  const eraYear = pickWithNull<number>(overrides, 'eraYear', 2026);
  const durationMs = overrides.durationMs ?? 180_000;
  const dateAdded = overrides.dateAdded ?? '2026-05-01T00:00:00Z';
  const storageKey = overrides.storageKey ?? `tracks/${id}.mp3`;

  const artistSql = artist === null ? 'NULL' : `'${artist.replace(/'/g, "''")}'`;
  const albumSql = album === null ? 'NULL' : `'${album.replace(/'/g, "''")}'`;
  const genreSql = genre === null ? 'NULL' : `'${genre.replace(/'/g, "''")}'`;
  const eraYearSql = eraYear === null ? 'NULL' : String(eraYear);

  handle.mem.public.none(
    `INSERT INTO radio_tracks (
      id, station_id, title, artist, album, genre, era_year, duration_ms,
      storage_key, date_added
    ) VALUES (
      '${id}', '${stationId}', '${title.replace(/'/g, "''")}', ${artistSql}, ${albumSql},
      ${genreSql}, ${eraYearSql}, ${durationMs}, '${storageKey}', '${dateAdded}'
    )`,
  );
}

/**
 * Seed an additional station + its org so cross-station leakage tests can
 * insert radio_tracks under that station without FK violations.
 */
function seedExtraStation(
  handle: TestDbHandle,
  stationId: string,
  orgId: string,
): void {
  const now = '2026-01-01T00:00:00Z';
  handle.mem.public.none(
    `INSERT INTO organizations (id, name, plan, created_at) VALUES ('${orgId}', 'Org', 'free', '${now}')`,
  );
  handle.mem.public.none(
    `INSERT INTO stations (id, org_id, slug, name, timezone, created_at) VALUES ('${stationId}', '${orgId}', 'extra', 'Extra', 'UTC', '${now}')`,
  );
}

// ---------------------------------------------------------------------------
// GET /api/catalog
// ---------------------------------------------------------------------------

describe('GET /api/catalog', () => {
  test('401 when no session cookie', async () => {
    const { handle } = await makeAuthedFixture();
    const res = await getCatalogIndex(buildRequest('/api/catalog'), {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(401);
  });

  test('200 with tracks scoped to the user station', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedExtraStation(handle, 'station-other', 'org-other');
    seedTrack(handle, user.stationId, { id: 't-1', title: 'Alpha' });
    seedTrack(handle, 'station-other', { id: 't-other', title: 'Beta' });

    const res = await getCatalogIndex(buildRequest('/api/catalog', cookie), {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tracks: Array<{ id: string; title: string }>;
      source: string;
      meta: { nextCursor: string | null; limit: number };
    };
    expect(body.source).toBe('d1');
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0].id).toBe('t-1');
    expect(body.meta.nextCursor).toBeNull();
  });

  test('limit > 200 clamps the response meta', async () => {
    const { handle, cookie } = await makeAuthedFixture();
    const res = await getCatalogIndex(
      buildRequest('/api/catalog?limit=9999', cookie),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { meta: { limit: number } };
    expect(body.meta.limit).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /api/catalog/tracks
// ---------------------------------------------------------------------------

describe('GET /api/catalog/tracks', () => {
  test('401 when no session cookie', async () => {
    const { handle } = await makeAuthedFixture();
    const res = await getCatalogTracks(buildRequest('/api/catalog/tracks'), {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(401);
  });

  test('200 returns rows scoped to the user station', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedExtraStation(handle, 'station-other', 'org-other');
    seedTrack(handle, user.stationId, { id: 't-here', title: 'In-Station' });
    seedTrack(handle, 'station-other', {
      id: 't-elsewhere',
      title: 'Cross-Station',
    });

    const res = await getCatalogTracks(
      buildRequest('/api/catalog/tracks', cookie),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tracks: Array<{ id: string }>;
    };
    expect(body.tracks.map((t) => t.id)).toEqual(['t-here']);
  });

  test('search filter matches title via LIKE', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedTrack(handle, user.stationId, { id: 't-keep', title: 'KeepMe' });
    seedTrack(handle, user.stationId, {
      id: 't-skip',
      title: 'OtherTrack',
      dateAdded: '2026-04-01T00:00:00Z',
    });

    const res = await getCatalogTracks(
      buildRequest('/api/catalog/tracks?search=KeepMe', cookie),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tracks: Array<{ id: string; title: string }>;
    };
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0].title).toBe('KeepMe');
  });

  test('full page emits nextCursor', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedTrack(handle, user.stationId, {
      id: 't-a',
      title: 'A',
      dateAdded: '2026-05-02T00:00:00Z',
    });
    seedTrack(handle, user.stationId, {
      id: 't-b',
      title: 'B',
      dateAdded: '2026-05-01T00:00:00Z',
    });

    const res = await getCatalogTracks(
      buildRequest('/api/catalog/tracks?limit=2', cookie),
      { db: handle.db, secret: SECRET },
    );
    const body = (await res.json()) as {
      meta: { nextCursor: string | null };
    };
    expect(body.meta.nextCursor).toBeTypeOf('string');
    const decoded = JSON.parse(
      Buffer.from(body.meta.nextCursor as string, 'base64url').toString('utf8'),
    );
    expect(decoded.lastId).toBe('t-b');
  });
});

// ---------------------------------------------------------------------------
// GET /api/catalog/albums
// ---------------------------------------------------------------------------

describe('GET /api/catalog/albums', () => {
  test('401 when no session cookie', async () => {
    const { handle } = await makeAuthedFixture();
    const res = await getCatalogAlbums(buildRequest('/api/catalog/albums'), {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(401);
  });

  test('200 groups derived albums for the station', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedTrack(handle, user.stationId, {
      id: 't-1',
      album: 'Album One',
      artist: 'Artist X',
    });
    seedTrack(handle, user.stationId, {
      id: 't-2',
      album: 'Album One',
      artist: 'Artist X',
      dateAdded: '2026-04-15T00:00:00Z',
    });
    seedTrack(handle, user.stationId, {
      id: 't-3',
      album: 'Album Two',
      artist: 'Artist X',
      dateAdded: '2026-04-01T00:00:00Z',
    });

    const res = await getCatalogAlbums(
      buildRequest('/api/catalog/albums', cookie),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      albums: Array<{ title: string; trackCount: number }>;
    };
    expect(body.albums).toHaveLength(2);
    const one = body.albums.find((a) => a.title === 'Album One');
    expect(one?.trackCount).toBe(2);
  });

  test('rows with NULL/empty album are filtered out', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedTrack(handle, user.stationId, { id: 't-null', album: null });

    const res = await getCatalogAlbums(
      buildRequest('/api/catalog/albums', cookie),
      { db: handle.db, secret: SECRET },
    );
    const body = (await res.json()) as { albums: unknown[] };
    expect(body.albums).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/catalog/albums/[id]
// ---------------------------------------------------------------------------

describe('GET /api/catalog/albums/[id]', () => {
  test('401 when no session cookie', async () => {
    const { handle } = await makeAuthedFixture();
    const res = await getCatalogAlbumById(
      buildRequest('/api/catalog/albums/album-foo'),
      { params: Promise.resolve({ id: 'album-foo' }) },
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('404 when slug not present in station', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedTrack(handle, user.stationId, { id: 't-x', album: 'Some Album' });
    const res = await getCatalogAlbumById(
      buildRequest('/api/catalog/albums/album-missing', cookie),
      { params: Promise.resolve({ id: 'album-missing' }) },
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(404);
  });

  test('200 returns the album when slug matches', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedTrack(handle, user.stationId, {
      id: 't-album-1',
      title: 'Track One',
      album: 'Some Album',
      artist: 'Some Artist',
    });
    const res = await getCatalogAlbumById(
      buildRequest('/api/catalog/albums/album-some-album', cookie),
      { params: Promise.resolve({ id: 'album-some-album' }) },
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      album: { title: string; trackCount: number; artistId: string };
      source: string;
    };
    expect(body.album.title).toBe('Some Album');
    expect(body.album.trackCount).toBe(1);
    expect(body.album.artistId).toBe('artist-some-artist');
    expect(body.source).toBe('d1');
  });
});

// ---------------------------------------------------------------------------
// GET /api/catalog/artists
// ---------------------------------------------------------------------------

describe('GET /api/catalog/artists', () => {
  test('401 when no session cookie', async () => {
    const { handle } = await makeAuthedFixture();
    const res = await getCatalogArtists(
      buildRequest('/api/catalog/artists'),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('200 groups artists by name across the station', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedTrack(handle, user.stationId, {
      id: 't-1',
      artist: 'Artist One',
      album: 'Album A',
    });
    seedTrack(handle, user.stationId, {
      id: 't-2',
      artist: 'Artist One',
      album: 'Album B',
    });
    seedTrack(handle, user.stationId, {
      id: 't-3',
      artist: 'Artist Two',
      album: 'Album C',
    });

    const res = await getCatalogArtists(
      buildRequest('/api/catalog/artists', cookie),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      artists: Array<{ name: string; trackCount: number; albumCount: number }>;
    };
    expect(body.artists).toHaveLength(2);
    const one = body.artists.find((a) => a.name === 'Artist One');
    expect(one?.trackCount).toBe(2);
    expect(one?.albumCount).toBe(2);
  });

  test('rows with NULL/empty artist are filtered out', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedTrack(handle, user.stationId, { id: 't-null', artist: null });
    const res = await getCatalogArtists(
      buildRequest('/api/catalog/artists', cookie),
      { db: handle.db, secret: SECRET },
    );
    const body = (await res.json()) as { artists: unknown[] };
    expect(body.artists).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// GET /api/catalog/artists/[id]
// ---------------------------------------------------------------------------

describe('GET /api/catalog/artists/[id]', () => {
  test('401 when no session cookie', async () => {
    const { handle } = await makeAuthedFixture();
    const res = await getCatalogArtistById(
      buildRequest('/api/catalog/artists/artist-foo'),
      { params: Promise.resolve({ id: 'artist-foo' }) },
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('404 when slug not present in station', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedTrack(handle, user.stationId, { id: 't-x', artist: 'Existing Artist' });
    const res = await getCatalogArtistById(
      buildRequest('/api/catalog/artists/artist-missing', cookie),
      { params: Promise.resolve({ id: 'artist-missing' }) },
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(404);
  });

  test('200 returns the artist with tracks + derived albums', async () => {
    const { handle, user, cookie } = await makeAuthedFixture();
    seedTrack(handle, user.stationId, {
      id: 't-art-1',
      artist: 'Some Artist',
      album: 'First Album',
      genre: 'rock',
    });
    seedTrack(handle, user.stationId, {
      id: 't-art-2',
      artist: 'Some Artist',
      album: 'Second Album',
      genre: 'pop',
    });
    const res = await getCatalogArtistById(
      buildRequest('/api/catalog/artists/artist-some-artist', cookie),
      { params: Promise.resolve({ id: 'artist-some-artist' }) },
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      artist: {
        name: string;
        trackCount: number;
        albumCount: number;
        genres: string[];
        albums: Array<{ title: string }>;
      };
    };
    expect(body.artist.name).toBe('Some Artist');
    expect(body.artist.trackCount).toBe(2);
    expect(body.artist.albumCount).toBe(2);
    expect(body.artist.genres.sort()).toEqual(['pop', 'rock']);
  });
});

// ---------------------------------------------------------------------------
// GET /api/catalog/playlists (stub — always empty)
// ---------------------------------------------------------------------------

describe('GET /api/catalog/playlists', () => {
  test('401 when no session cookie', async () => {
    const { handle } = await makeAuthedFixture();
    const res = await getCatalogPlaylists(
      buildRequest('/api/catalog/playlists'),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('200 with empty list + clamped limit', async () => {
    const { handle, cookie } = await makeAuthedFixture();
    const res = await getCatalogPlaylists(
      buildRequest('/api/catalog/playlists?limit=9999', cookie),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      playlists: unknown[];
      source: string;
      meta: { nextCursor: string | null; limit: number };
    };
    expect(body.playlists).toEqual([]);
    expect(body.source).toBe('d1');
    expect(body.meta.limit).toBe(200);
    expect(body.meta.nextCursor).toBeNull();
  });

  test('default limit applies when none passed', async () => {
    const { handle, cookie } = await makeAuthedFixture();
    const res = await getCatalogPlaylists(
      buildRequest('/api/catalog/playlists', cookie),
      { db: handle.db, secret: SECRET },
    );
    const body = (await res.json()) as { meta: { limit: number } };
    expect(body.meta.limit).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// GET /api/catalog/playlists/[id] (stub — always 404 after gate)
// ---------------------------------------------------------------------------

describe('GET /api/catalog/playlists/[id]', () => {
  test('401 when no session cookie', async () => {
    const { handle } = await makeAuthedFixture();
    const res = await getCatalogPlaylistById(
      buildRequest('/api/catalog/playlists/anything'),
      { params: Promise.resolve({ id: 'anything' }) },
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('404 for any id when authenticated (Phase 1 stub)', async () => {
    const { handle, cookie } = await makeAuthedFixture();
    const res = await getCatalogPlaylistById(
      buildRequest('/api/catalog/playlists/anything', cookie),
      { params: Promise.resolve({ id: 'anything' }) },
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Playlist not found');
  });
});
