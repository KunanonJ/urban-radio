import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet, onRequest } from './index';
import { getSessionFromRequest } from '../../_lib/session-jwt';
import type { SonicBloomEnv } from '../../_lib/env';

type AllResult = { results: unknown[]; success?: boolean };

interface PreparedStatement {
  sql: string;
  binds: unknown[];
  ran: boolean;
}

const buildD1 = (
  allResults: AllResult[],
): {
  prepare: ReturnType<typeof vi.fn>;
  preparedStatements: PreparedStatement[];
} => {
  const preparedStatements: PreparedStatement[] = [];
  let allCallIdx = 0;
  const prepare = vi.fn((sql: string) => {
    const stmt: PreparedStatement = { sql, binds: [], ran: false };
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
      run: vi.fn().mockImplementation(() => {
        stmt.ran = true;
        return Promise.resolve({ success: true, meta: {} });
      }),
    };
    return chain;
  });
  return { prepare, preparedStatements };
};

const buildEnv = (
  opts: { allResults?: AllResult[]; secretSet?: boolean } = {},
): { env: SonicBloomEnv; mockDb: ReturnType<typeof buildD1> } => {
  const { allResults = [], secretSet = true } = opts;
  const mockDb = buildD1(allResults);
  const env = {
    DB: mockDb,
    AUTH_JWT_SECRET: secretSet ? 'test-secret' : '',
  } as unknown as SonicBloomEnv;
  return { env, mockDb };
};

const buildRequest = (path: string) => {
  return new Request(`http://localhost${path}`, {
    headers: { cookie: 'sb_session=valid-token' },
  });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

const presenceRow = {
  id: 'p-1',
  station_id: 'urban-radio',
  user_id: 'user-1',
  target_type: 'clock',
  target_id: 'clk-1',
  last_heartbeat_at: '2026-05-14T10:00:00Z',
  created_at: '2026-05-14T10:00:00Z',
  username: 'demo',
};
const otherUserRow = {
  ...presenceRow,
  id: 'p-2',
  user_id: 'user-2',
  username: 'producer',
  last_heartbeat_at: '2026-05-14T10:00:05Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/presence', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv();
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/presence?targetType=clock&targetId=clk-1'),
    });
    expect(res.status).toBe(401);
  });

  test('given no station membership > 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({ allResults: [{ results: [], success: true }] });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/presence?targetType=clock&targetId=clk-1'),
    });
    expect(res.status).toBe(403);
  });

  test('missing targetType or targetId > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/presence'),
    });
    expect(res.status).toBe(400);
  });

  test('unknown targetType > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/presence?targetType=mystery&targetId=x'),
    });
    expect(res.status).toBe(400);
  });

  test('valid query > 200 with sessions scoped to caller station + target', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [presenceRow, otherUserRow], success: true },
      ],
    });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/presence?targetType=clock&targetId=clk-1'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: { userId: string; username: string | null; targetType: string }[];
      meta: { ttlSeconds: number };
    };
    expect(body.sessions).toHaveLength(2);
    const userIds = body.sessions.map((s) => s.userId);
    expect(userIds).toContain('user-1');
    expect(userIds).toContain('user-2');
    expect(body.meta.ttlSeconds).toBeGreaterThan(0);

    const listStmt = mockDb.preparedStatements.find(
      (s) =>
        /FROM presence_sessions p/i.test(s.sql) &&
        /LEFT JOIN auth_users/i.test(s.sql),
    );
    expect(listStmt).toBeDefined();
    expect(listStmt!.binds).toEqual(['urban-radio', 'clock', 'clk-1']);
  });

  test('empty active list > 200 with empty array', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [], success: true },
      ],
    });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/presence?targetType=clock&targetId=clk-1'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[] };
    expect(body.sessions).toEqual([]);
  });

  test('list SQL applies the TTL filter datetime("now", "-15 seconds")', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [], success: true },
      ],
    });
    await onRequestGet({
      env,
      request: buildRequest('/api/presence?targetType=clock&targetId=clk-1'),
    });
    const listStmt = mockDb.preparedStatements.find((s) =>
      /FROM presence_sessions p/i.test(s.sql),
    );
    expect(listStmt!.sql).toMatch(/datetime\('now', '-15 seconds'\)/);
  });

  test('all 6 target_type values are accepted by the query schema', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const types = [
      'clock',
      'clock_slot',
      'schedule_assignment',
      'voice_track',
      'radio_track',
      'schedule_cell',
    ];
    for (const t of types) {
      const { env } = buildEnv({
        allResults: [
          { results: [memberRow], success: true },
          { results: [], success: true },
        ],
      });
      const res = await onRequestGet({
        env,
        request: buildRequest(`/api/presence?targetType=${t}&targetId=x`),
      });
      expect(res.status).toBe(200);
    }
  });

  test('cross-station enumeration > only caller stationId is bound, not query string', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [], success: true },
      ],
    });
    await onRequestGet({
      env,
      // Attacker tries to inject another station in the URL.
      request: buildRequest(
        '/api/presence?targetType=clock&targetId=clk-1&stationId=other-station',
      ),
    });
    const listStmt = mockDb.preparedStatements.find((s) =>
      /FROM presence_sessions p/i.test(s.sql),
    );
    expect(listStmt!.binds).toContain('urban-radio');
    expect(listStmt!.binds).not.toContain('other-station');
  });

  test('onRequest dispatch > non-GET returns 405', async () => {
    const { env } = buildEnv();
    const res = await onRequest({
      env,
      request: new Request('http://localhost/api/presence', { method: 'POST' }),
    });
    expect(res.status).toBe(405);
  });

  test('onRequest dispatch > GET reaches handler (auth gate fires)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv();
    const res = await onRequest({
      env,
      request: buildRequest('/api/presence?targetType=clock&targetId=clk-1'),
    });
    expect(res.status).toBe(401);
  });
});
