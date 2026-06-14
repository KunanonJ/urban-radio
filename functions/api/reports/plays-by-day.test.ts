import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet } from './plays-by-day';
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

const buildRequest = (path = '/api/reports/plays-by-day') => {
  const headers = new Headers();
  headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/reports/plays-by-day', () => {
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

  test('given valid session > returns days[] shape ordered ASC', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      {
        results: [
          { day: '2026-05-10', plays: 3 },
          { day: '2026-05-11', plays: 7 },
        ],
        success: true,
      },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      days: { day: string; plays: number }[];
      range: { from: string | null; to: string | null };
      source: string | null;
    };
    expect(body.days).toHaveLength(2);
    expect(body.days[0].day).toBe('2026-05-10');
    expect(body.days[0].plays).toBe(3);
    expect(body.days[1].day).toBe('2026-05-11');
    expect(body.days[1].plays).toBe(7);
    const stmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(stmt!.binds[0]).toBe('urban-radio');
    expect(stmt!.sql).toMatch(/ORDER BY day ASC/);
  });

  test('?source filter > forwards source bind to query', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/reports/plays-by-day?source=automation'),
    });
    expect(res.status).toBe(200);
    const stmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(stmt!.binds).toContain('automation');
    expect(stmt!.sql).toMatch(/source = \?/);
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
        '/api/reports/plays-by-day?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      ),
    });
    expect(res.status).toBe(200);
    const stmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(stmt!.binds).toContain('2026-01-01T00:00:00Z');
    expect(stmt!.binds).toContain('2026-02-01T00:00:00Z');
  });

  test('?to invalid > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/reports/plays-by-day?to=bogus'),
    });
    expect(res.status).toBe(400);
  });
});
