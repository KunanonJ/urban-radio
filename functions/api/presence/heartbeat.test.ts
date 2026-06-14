import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestPost, onRequest } from './heartbeat';
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

const buildRequest = (init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Request('http://localhost/api/presence/heartbeat', {
    method: 'POST',
    ...init,
    headers,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/presence/heartbeat', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv();
    const res = await onRequestPost({
      env,
      request: buildRequest({
        body: JSON.stringify({ targetType: 'clock', targetId: 'clk-1' }),
      }),
    });
    expect(res.status).toBe(401);
  });

  test('given no station membership > 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({ allResults: [{ results: [], success: true }] });
    const res = await onRequestPost({
      env,
      request: buildRequest({
        body: JSON.stringify({ targetType: 'clock', targetId: 'clk-1' }),
      }),
    });
    expect(res.status).toBe(403);
  });

  test('missing targetType / targetId > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const res = await onRequestPost({
      env,
      request: buildRequest({ body: JSON.stringify({}) }),
    });
    expect(res.status).toBe(400);
  });

  test('invalid JSON body > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const res = await onRequestPost({
      env,
      request: buildRequest({ body: 'not-json' }),
    });
    expect(res.status).toBe(400);
  });

  test('unknown targetType > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const res = await onRequestPost({
      env,
      request: buildRequest({
        body: JSON.stringify({ targetType: 'mystery', targetId: 'x' }),
      }),
    });
    expect(res.status).toBe(400);
  });

  test('valid payload > 200 + upsert + active session list returned', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true }, // requireStation lookup
        { results: [presenceRow], success: true }, // active sessions list
      ],
    });
    const res = await onRequestPost({
      env,
      request: buildRequest({
        body: JSON.stringify({ targetType: 'clock', targetId: 'clk-1' }),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: { userId: string; username: string | null; targetType: string }[];
      meta: { ttlSeconds: number };
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].userId).toBe('user-1');
    expect(body.sessions[0].username).toBe('demo');
    expect(body.sessions[0].targetType).toBe('clock');
    expect(body.meta.ttlSeconds).toBeGreaterThan(0);

    const upsertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO presence_sessions/i.test(s.sql),
    );
    expect(upsertStmt).toBeDefined();
    expect(upsertStmt!.sql).toMatch(/ON CONFLICT/);
    expect(upsertStmt!.binds).toContain('urban-radio');
    expect(upsertStmt!.binds).toContain('user-1');
    expect(upsertStmt!.binds).toContain('clock');
    expect(upsertStmt!.binds).toContain('clk-1');
    expect(upsertStmt!.ran).toBe(true);
  });

  test('best-effort cleanup statement is fired alongside heartbeat', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [], success: true },
      ],
    });
    await onRequestPost({
      env,
      request: buildRequest({
        body: JSON.stringify({ targetType: 'voice_track', targetId: 'vt-1' }),
      }),
    });
    const cleanupStmt = mockDb.preparedStatements.find((s) =>
      /DELETE FROM presence_sessions/i.test(s.sql),
    );
    expect(cleanupStmt).toBeDefined();
  });

  test('cross-station stationId in body is ignored — server uses gate stationId', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [], success: true },
      ],
    });
    await onRequestPost({
      env,
      request: buildRequest({
        body: JSON.stringify({
          targetType: 'clock',
          targetId: 'clk-1',
          stationId: 'other-station',
          station_id: 'other-station',
        }),
      }),
    });
    const upsertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO presence_sessions/i.test(s.sql),
    );
    expect(upsertStmt!.binds).toContain('urban-radio');
    expect(upsertStmt!.binds).not.toContain('other-station');
  });

  test('list query is station + target scoped', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [presenceRow], success: true },
      ],
    });
    await onRequestPost({
      env,
      request: buildRequest({
        body: JSON.stringify({ targetType: 'schedule_cell', targetId: 'cell-9' }),
      }),
    });
    const listStmt = mockDb.preparedStatements.find(
      (s) =>
        /FROM presence_sessions p/i.test(s.sql) &&
        /LEFT JOIN auth_users/i.test(s.sql),
    );
    expect(listStmt).toBeDefined();
    expect(listStmt!.binds).toEqual(['urban-radio', 'schedule_cell', 'cell-9']);
  });

  test('onRequest dispatch > non-POST returns 405', async () => {
    const { env } = buildEnv();
    const res = await onRequest({
      env,
      request: new Request('http://localhost/api/presence/heartbeat', {
        method: 'GET',
      }),
    });
    expect(res.status).toBe(405);
  });

  test('onRequest dispatch > POST is routed through', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv();
    const res = await onRequest({
      env,
      request: buildRequest({
        body: JSON.stringify({ targetType: 'clock', targetId: 'clk-1' }),
      }),
    });
    // 401 because the session mock returned null; the important bit is the
    // request reached onRequestPost (not 405).
    expect(res.status).toBe(401);
  });
});
