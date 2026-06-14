import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet } from './overview';
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

const buildRequest = (path = '/api/reports/overview') => {
  const headers = new Headers();
  headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/reports/overview', () => {
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

  test('given valid session > returns 200 with overview shape', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      {
        results: [
          {
            totalPlays: 120,
            uniqueTitles: 47,
            daysWithActivity: 7,
            totalListeningHours: 6.5,
          },
        ],
        success: true,
      },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      overview: {
        totalPlays: number;
        uniqueTitles: number;
        daysWithActivity: number;
        totalListeningHours: number;
      };
      range: { from: string | null; to: string | null };
    };
    expect(body.overview.totalPlays).toBe(120);
    expect(body.overview.uniqueTitles).toBe(47);
    expect(body.overview.daysWithActivity).toBe(7);
    expect(body.overview.totalListeningHours).toBe(6.5);
    // Station scope check: station_id must be bound first on the play_log query.
    const reportStmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(reportStmt).toBeDefined();
    expect(reportStmt!.binds[0]).toBe('urban-radio');
  });

  test('?from + ?to > forwards date range binds to query', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      {
        results: [
          {
            totalPlays: 0,
            uniqueTitles: 0,
            daysWithActivity: 0,
            totalListeningHours: 0,
          },
        ],
        success: true,
      },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/reports/overview?from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z'),
    });
    expect(res.status).toBe(200);
    const stmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(stmt!.binds).toContain('2026-01-01T00:00:00Z');
    expect(stmt!.binds).toContain('2026-02-01T00:00:00Z');
    expect(stmt!.sql).toMatch(/played_at >= \?/);
    expect(stmt!.sql).toMatch(/played_at < \?/);
  });

  test('?from invalid > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/reports/overview?from=not-a-date'),
    });
    expect(res.status).toBe(400);
  });

  test('caller cannot spoof station_id via query — stationId from gate', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      {
        results: [
          {
            totalPlays: 0,
            uniqueTitles: 0,
            daysWithActivity: 0,
            totalListeningHours: 0,
          },
        ],
        success: true,
      },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/reports/overview?stationId=other-station&station_id=other-station'),
    });
    expect(res.status).toBe(200);
    const stmt = mockDb.preparedStatements.find((s) => /FROM play_log/.test(s.sql));
    expect(stmt!.binds[0]).toBe('urban-radio');
    expect(stmt!.binds).not.toContain('other-station');
  });
});
