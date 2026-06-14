import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the session module BEFORE importing the handler.
vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet } from './tracks';
import { onRequestGet as albumDetail } from './albums/[id]';
import { onRequestGet as artistDetail } from './artists/[id]';
import { onRequestGet as playlistDetail } from './playlists/[id]';
import { getSessionFromRequest } from '../../_lib/session-jwt';
import type { SonicBloomEnv } from '../../_lib/env';

type AllResult = { results: unknown[]; success?: boolean };

const buildD1 = (
  allResults: AllResult[],
  firstResults: (unknown | null)[] = [],
): {
  prepare: ReturnType<typeof vi.fn>;
  preparedStatements: { sql: string; binds: unknown[] }[];
} => {
  const preparedStatements: { sql: string; binds: unknown[] }[] = [];
  let allCallIdx = 0;
  let firstCallIdx = 0;
  const prepare = vi.fn((sql: string) => {
    const stmt = { sql, binds: [] as unknown[] };
    preparedStatements.push(stmt);
    const chain = {
      bind: (...args: unknown[]) => {
        stmt.binds.push(...args);
        return chain;
      },
      all: vi.fn().mockImplementation(() => {
        const res = allResults[allCallIdx] ?? { results: [], success: true };
        allCallIdx += 1;
        return Promise.resolve(res);
      }),
      first: vi.fn().mockImplementation(() => {
        const res = firstResults[firstCallIdx] ?? null;
        firstCallIdx += 1;
        return Promise.resolve(res);
      }),
    };
    return chain;
  });
  return { prepare, preparedStatements };
};

// Cast to SonicBloomEnv at the boundary — the mock satisfies the D1 surface
// required by the handler at runtime.
const buildEnv = (
  allResults: AllResult[],
  firstResults: (unknown | null)[] = [],
): { env: SonicBloomEnv; mockDb: ReturnType<typeof buildD1> } => {
  const mockDb = buildD1(allResults, firstResults);
  return {
    env: { DB: mockDb, AUTH_JWT_SECRET: 'test-secret' } as unknown as SonicBloomEnv,
    mockDb,
  };
};

const buildRequest = (path = '/api/catalog/tracks', cookie = 'sb_session=valid-token') => {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost${path}`, { headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

const trackRow = {
  id: 't1',
  station_id: 'urban-radio',
  category_id: 'cat-music',
  title: 'Song',
  artist: 'Some Artist',
  album: 'Some Album',
  genre: 'pop',
  bpm: 120,
  music_key: 'C',
  energy: 5,
  era_year: 2024,
  language: 'en',
  duration_ms: 180000,
  cue_in_ms: 0,
  cue_out_ms: null,
  intro_ms: null,
  outro_ms: null,
  mix_point_ms: null,
  loudness_lufs: null,
  file_type: 'music',
  content_hash: 'hash-1',
  storage_key: 'tracks/t1.mp3',
  custom_f1: null,
  custom_f2: null,
  custom_f3: null,
  custom_f4: null,
  custom_f5: null,
  rating: 4,
  play_count: 0,
  last_played_at: null,
  date_added: '2026-05-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/catalog/tracks', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/unauth/i);
  });

  test('given AUTH_JWT_SECRET unset > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    env.AUTH_JWT_SECRET = '';
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(401);
  });

  test('given valid session but no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // First all() is for station_members lookup → returns no rows
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(403);
  });

  test('given valid session + station > returns rows scoped to station', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // [0] station_members, [1] radio_tracks list
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [trackRow], success: true },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tracks: { id: string; title: string; artist: string }[];
      source: string;
      meta: { nextCursor: string | null };
    };
    expect(body.source).toBe('d1');
    expect(body.tracks).toHaveLength(1);
    expect(body.tracks[0].id).toBe('t1');
    expect(body.tracks[0].title).toBe('Song');
    expect(body.tracks[0].artist).toBe('Some Artist');
    // Verify station_id was the first bind on the tracks query
    const tracksStmt = mockDb.preparedStatements.find((s) =>
      /radio_tracks/.test(s.sql) && /ORDER BY date_added/.test(s.sql),
    );
    expect(tracksStmt).toBeDefined();
    expect(tracksStmt!.binds[0]).toBe('urban-radio');
  });

  test('given limit > 200 > clamps to 200 in the SQL emitted', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    await onRequestGet({
      env,
      request: buildRequest('/api/catalog/tracks?limit=9999'),
    });
    const tracksStmt = mockDb.preparedStatements.find(
      (s) => /radio_tracks/.test(s.sql) && /ORDER BY date_added/.test(s.sql),
    );
    expect(tracksStmt).toBeDefined();
    expect(tracksStmt!.sql).toMatch(/LIMIT 200/);
  });

  test('given cursor query param > forwards to query builder', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const cursor = Buffer.from(
      JSON.stringify({ lastDate: '2026-04-01T00:00:00Z', lastId: 'prev' }),
      'utf8',
    ).toString('base64url');
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    await onRequestGet({
      env,
      request: buildRequest(`/api/catalog/tracks?cursor=${encodeURIComponent(cursor)}`),
    });
    const tracksStmt = mockDb.preparedStatements.find(
      (s) => /radio_tracks/.test(s.sql) && /ORDER BY date_added/.test(s.sql),
    );
    expect(tracksStmt).toBeDefined();
    expect(tracksStmt!.sql).toMatch(/\(date_added, id\) < \(\?, \?\)/);
    expect(tracksStmt!.binds).toContain('2026-04-01T00:00:00Z');
    expect(tracksStmt!.binds).toContain('prev');
  });

  test('given full page > emits nextCursor', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // Two rows + limit=2 → next page expected
    const rowB = { ...trackRow, id: 't2', date_added: '2026-04-15T00:00:00Z' };
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [trackRow, rowB], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/catalog/tracks?limit=2'),
    });
    const body = (await res.json()) as { meta: { nextCursor: string | null } };
    expect(body.meta.nextCursor).toBeTypeOf('string');
    const decoded = JSON.parse(
      Buffer.from(body.meta.nextCursor as string, 'base64url').toString('utf8'),
    );
    expect(decoded.lastId).toBe('t2');
  });

  test('given partial page > nextCursor is null', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [trackRow], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/catalog/tracks?limit=50'),
    });
    const body = (await res.json()) as { meta: { nextCursor: string | null } };
    expect(body.meta.nextCursor).toBeNull();
  });

  test('given search query param > forwards to query builder', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    await onRequestGet({
      env,
      request: buildRequest('/api/catalog/tracks?search=foo'),
    });
    const tracksStmt = mockDb.preparedStatements.find(
      (s) => /radio_tracks/.test(s.sql) && /ORDER BY date_added/.test(s.sql),
    );
    expect(tracksStmt).toBeDefined();
    expect(tracksStmt!.binds).toContain('%foo%');
  });
});

// ---------------------------------------------------------------------------
// Detail endpoints — must enforce station scoping and not leak cross-station
// existence. Tests live here per ALLOWED FILES scope; they cover the
// 404-when-not-in-station and 401/403 gate behaviour for [id] routes.
// ---------------------------------------------------------------------------

describe('GET /api/catalog/albums/[id]', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await albumDetail({
      env,
      request: buildRequest('/api/catalog/albums/album-foo'),
      params: { id: 'album-foo' },
    });
    expect(res.status).toBe(401);
  });

  test('given no membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await albumDetail({
      env,
      request: buildRequest('/api/catalog/albums/album-foo'),
      params: { id: 'album-foo' },
    });
    expect(res.status).toBe(403);
  });

  test('given album slug not present for the station > returns 404 (no leak)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const otherAlbumRow = {
      ...trackRow,
      album: 'Some Other Album',
    };
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [otherAlbumRow], success: true },
    ]);
    const res = await albumDetail({
      env,
      request: buildRequest('/api/catalog/albums/album-missing'),
      params: { id: 'album-missing' },
    });
    expect(res.status).toBe(404);
  });

  test('given album matches in station > scopes every SQL to station_id', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [trackRow], success: true },
      { results: [trackRow], success: true },
    ]);
    const res = await albumDetail({
      env,
      request: buildRequest('/api/catalog/albums/album-some-album'),
      params: { id: 'album-some-album' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { album: { title: string; trackCount: number } };
    expect(body.album.title).toBe('Some Album');
    expect(body.album.trackCount).toBe(1);
    const trackStmts = mockDb.preparedStatements.filter((s) =>
      /FROM radio_tracks/.test(s.sql),
    );
    expect(trackStmts.length).toBeGreaterThan(0);
    for (const s of trackStmts) {
      expect(s.binds[0]).toBe('urban-radio');
    }
  });
});

describe('GET /api/catalog/artists/[id]', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await artistDetail({
      env,
      request: buildRequest('/api/catalog/artists/artist-foo'),
      params: { id: 'artist-foo' },
    });
    expect(res.status).toBe(401);
  });

  test('given no membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await artistDetail({
      env,
      request: buildRequest('/api/catalog/artists/artist-foo'),
      params: { id: 'artist-foo' },
    });
    expect(res.status).toBe(403);
  });

  test('given artist not present in station > returns 404', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [{ artist: 'Different Artist' }], success: true },
    ]);
    const res = await artistDetail({
      env,
      request: buildRequest('/api/catalog/artists/artist-missing'),
      params: { id: 'artist-missing' },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/catalog/playlists/[id]', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await playlistDetail({
      env,
      request: buildRequest('/api/catalog/playlists/foo'),
      params: { id: 'foo' },
    });
    expect(res.status).toBe(401);
  });

  test('given no membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await playlistDetail({
      env,
      request: buildRequest('/api/catalog/playlists/foo'),
      params: { id: 'foo' },
    });
    expect(res.status).toBe(403);
  });

  test('given valid station member > 404 (playlists not present in Phase 1)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await playlistDetail({
      env,
      request: buildRequest('/api/catalog/playlists/foo'),
      params: { id: 'foo' },
    });
    expect(res.status).toBe(404);
  });
});
