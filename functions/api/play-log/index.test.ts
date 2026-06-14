import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the session module BEFORE importing the handler.
vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet, onRequestPost } from './index';
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
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    return chain;
  });
  return { prepare, preparedStatements };
};

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

const buildRequest = (path = '/api/play-log', init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

const playLogRow = {
  id: 'p1',
  station_id: 'urban-radio',
  track_id: 't1',
  title_snapshot: 'Song Title',
  artist_snapshot: 'Some Artist',
  played_at: '2026-05-13T10:00:00Z',
  duration_played_ms: 180000,
  source: 'automation',
  isrc: 'USRC17607839',
  iswc: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/play-log', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(401);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(403);
  });

  test('given valid session > scopes results to caller station', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [playLogRow], success: true },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: { id: string; stationId: string; titleSnapshot: string }[];
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].id).toBe('p1');
    expect(body.entries[0].stationId).toBe('urban-radio');
    expect(body.entries[0].titleSnapshot).toBe('Song Title');
    // First bind on play_log SELECT must be the gate-resolved stationId.
    const listStmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(listStmt).toBeDefined();
    expect(listStmt!.binds[0]).toBe('urban-radio');
  });

  test('?aggregate=true > returns aggregate shape grouped by title+artist', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      {
        results: [{ title_snapshot: 'Hit Song', artist_snapshot: 'Big Artist', plays: 12 }],
        success: true,
      },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/play-log?aggregate=true'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      aggregate: { title: string; artist: string | null; plays: number }[];
    };
    expect(body.aggregate).toHaveLength(1);
    expect(body.aggregate[0].title).toBe('Hit Song');
    expect(body.aggregate[0].artist).toBe('Big Artist');
    expect(body.aggregate[0].plays).toBe(12);
    // SQL must group by title_snapshot, artist_snapshot
    const aggStmt = mockDb.preparedStatements.find((s) => /GROUP BY/.test(s.sql));
    expect(aggStmt).toBeDefined();
    expect(aggStmt!.sql).toMatch(/GROUP BY title_snapshot, artist_snapshot/);
  });

  test('?from + ?to > filters list by date range', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/play-log?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z'),
    });
    expect(res.status).toBe(200);
    const listStmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(listStmt!.binds).toContain('2026-01-01T00:00:00Z');
    expect(listStmt!.binds).toContain('2026-02-01T00:00:00Z');
    expect(listStmt!.sql).toMatch(/played_at >= \?/);
    expect(listStmt!.sql).toMatch(/played_at < \?/);
  });

  test('?cursor=X > forwards decoded keyset cursor binds', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const cursor = Buffer.from(
      JSON.stringify({ lastPlayedAt: '2026-05-13T10:00:00Z', lastId: 'p1' }),
      'utf8',
    ).toString('base64url');
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest(`/api/play-log?cursor=${cursor}`),
    });
    expect(res.status).toBe(200);
    const listStmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(listStmt!.binds).toContain('2026-05-13T10:00:00Z');
    expect(listStmt!.binds).toContain('p1');
    expect(listStmt!.sql).toMatch(/\(played_at, id\) < \(\?, \?\)/);
  });

  test('returns meta.nextCursor when results fill the page', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // Use limit=1 so a single row fills the page.
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [playLogRow], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/play-log?limit=1'),
    });
    const body = (await res.json()) as { meta: { nextCursor: string | null; limit: number } };
    expect(body.meta.limit).toBe(1);
    expect(typeof body.meta.nextCursor).toBe('string');
    expect(body.meta.nextCursor).not.toBeNull();
  });

  test('?source filter > forwards source bind', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/play-log?source=automation'),
    });
    expect(res.status).toBe(200);
    const listStmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(listStmt!.sql).toMatch(/source = \?/);
    expect(listStmt!.binds).toContain('automation');
  });
});

describe('POST /api/play-log', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/play-log', {
        method: 'POST',
        body: JSON.stringify({ titleSnapshot: 'X', source: 'automation' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(401);
  });

  test('given no station > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/play-log', {
        method: 'POST',
        body: JSON.stringify({ titleSnapshot: 'X', source: 'automation' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(403);
  });

  test('given valid body > inserts row and returns 201', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/play-log', {
        method: 'POST',
        body: JSON.stringify({
          trackId: 't1',
          titleSnapshot: 'Song Title',
          artistSnapshot: 'Some Artist',
          playedAt: '2026-05-13T10:00:00Z',
          durationPlayedMs: 180000,
          source: 'automation',
          isrc: 'USRC17607839',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      entry: { id: string; stationId: string; titleSnapshot: string; source: string };
    };
    expect(body.entry.titleSnapshot).toBe('Song Title');
    expect(body.entry.source).toBe('automation');
    expect(typeof body.entry.id).toBe('string');
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO play_log/i.test(s.sql),
    );
    expect(insertStmt).toBeDefined();
    expect(insertStmt!.binds).toContain('Song Title');
    expect(insertStmt!.binds).toContain('urban-radio');
    expect(insertStmt!.binds).toContain('automation');
  });

  test('given missing titleSnapshot > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/play-log', {
        method: 'POST',
        body: JSON.stringify({ source: 'automation' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given invalid source > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/play-log', {
        method: 'POST',
        body: JSON.stringify({ titleSnapshot: 'X', source: 'now_playing' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given invalid JSON body > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/play-log', {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('caller body cannot spoof station_id — server uses gate.context.stationId', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/play-log', {
        method: 'POST',
        // Body attempts to set a foreign station_id; server must ignore it.
        body: JSON.stringify({
          stationId: 'other-station',
          station_id: 'other-station',
          titleSnapshot: 'Song',
          source: 'automation',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(201);
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO play_log/i.test(s.sql),
    );
    expect(insertStmt).toBeDefined();
    expect(insertStmt!.binds).toContain('urban-radio');
    expect(insertStmt!.binds).not.toContain('other-station');
  });

  test('defaults playedAt to datetime("now") when omitted', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/play-log', {
        method: 'POST',
        body: JSON.stringify({ titleSnapshot: 'Song', source: 'automation' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(201);
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO play_log/i.test(s.sql),
    );
    expect(insertStmt!.sql).toMatch(/datetime\('now'\)/);
  });
});
