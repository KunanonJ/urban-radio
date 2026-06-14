import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet } from './top-tracks';
import { getSessionFromRequest } from '../../_lib/session-jwt';
import type { SonicBloomEnv } from '../../_lib/env';

type AllResult = { results: unknown[]; success?: boolean };

const buildD1 = (allResults: AllResult[]) => {
  const preparedStatements: { sql: string; binds: unknown[] }[] = [];
  let allCallIdx = 0;
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
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    return chain;
  });
  return { prepare, preparedStatements };
};

const buildEnv = (allResults: AllResult[]) => {
  const mockDb = buildD1(allResults);
  return {
    env: { DB: mockDb, AUTH_JWT_SECRET: 'test-secret' } as unknown as SonicBloomEnv,
    mockDb,
  };
};

const buildRequest = (path = '/api/reports/top-tracks') => {
  const headers = new Headers();
  headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/reports/top-tracks', () => {
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

  test('given valid session > returns tracks[] with title, artist, plays', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      {
        results: [
          { title_snapshot: 'Hit Song', artist_snapshot: 'Big Artist', plays: 25 },
          { title_snapshot: 'Other Song', artist_snapshot: null, plays: 10 },
        ],
        success: true,
      },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tracks: { title: string; artist: string | null; plays: number }[];
      limit: number;
      range: { from: string | null; to: string | null };
    };
    expect(body.tracks).toHaveLength(2);
    expect(body.tracks[0].title).toBe('Hit Song');
    expect(body.tracks[0].artist).toBe('Big Artist');
    expect(body.tracks[0].plays).toBe(25);
    expect(body.tracks[1].artist).toBeNull();
    const stmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(stmt!.binds[0]).toBe('urban-radio');
    expect(stmt!.sql).toMatch(/GROUP BY title_snapshot, artist_snapshot/);
  });

  test('?limit=5 > emits LIMIT 5', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/reports/top-tracks?limit=5'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { limit: number };
    expect(body.limit).toBe(5);
    const stmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(stmt!.sql).toMatch(/LIMIT 5/);
  });

  test('?limit=9999 > clamps to 200', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/reports/top-tracks?limit=9999'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { limit: number };
    expect(body.limit).toBe(200);
    const stmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(stmt!.sql).toMatch(/LIMIT 200/);
  });

  test('?from + ?to > forwards date range to query', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest(
        '/api/reports/top-tracks?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      ),
    });
    expect(res.status).toBe(200);
    const stmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(stmt!.binds).toContain('2026-01-01T00:00:00Z');
    expect(stmt!.binds).toContain('2026-02-01T00:00:00Z');
  });

  test('?source filter > forwards source bind to query', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/reports/top-tracks?source=automation'),
    });
    expect(res.status).toBe(200);
    const stmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(stmt!.binds).toContain('automation');
    expect(stmt!.sql).toMatch(/source = \?/);
  });

  test('?from invalid > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/reports/top-tracks?from=invalid-date'),
    });
    expect(res.status).toBe(400);
  });
});
