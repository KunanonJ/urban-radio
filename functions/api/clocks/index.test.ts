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

const buildRequest = (path = '/api/clocks', init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

const clockRow = {
  id: 'c1',
  station_id: 'urban-radio',
  name: 'Morning Mix',
  color: '#3b82f6',
  target_duration_ms: 3600000,
  created_at: '2026-05-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/clocks', () => {
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

  test('given valid session > returns station-scoped clocks only', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [clockRow], success: true },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clocks: { id: string; name: string }[] };
    expect(body.clocks).toHaveLength(1);
    expect(body.clocks[0].id).toBe('c1');
    expect(body.clocks[0].name).toBe('Morning Mix');
    // Station_id must be the first bind on the clocks query
    const clocksStmt = mockDb.preparedStatements.find((s) => /FROM clocks/.test(s.sql));
    expect(clocksStmt).toBeDefined();
    expect(clocksStmt!.binds[0]).toBe('urban-radio');
  });
});

describe('POST /api/clocks', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/clocks', {
        method: 'POST',
        body: JSON.stringify({ name: 'X' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(401);
  });

  test('given valid body > creates clock and writes audit_log', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/clocks', {
        method: 'POST',
        body: JSON.stringify({ name: 'Morning Mix', color: '#abcdef', targetDurationMs: 1800000 }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { clock: { id: string; name: string } };
    expect(body.clock.name).toBe('Morning Mix');
    expect(typeof body.clock.id).toBe('string');
    // Verify INSERT INTO clocks happened
    const insertClock = mockDb.preparedStatements.find(
      (s) => /INSERT INTO clocks/i.test(s.sql),
    );
    expect(insertClock).toBeDefined();
    expect(insertClock!.binds).toContain('Morning Mix');
    expect(insertClock!.binds).toContain('urban-radio');
    // Verify audit_log INSERT happened
    const auditStmt = mockDb.preparedStatements.find(
      (s) => /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('urban-radio');
    expect(auditStmt!.binds).toContain('user-1');
    expect(auditStmt!.binds).toContain('create');
    expect(auditStmt!.binds).toContain('clock');
  });

  test('given missing name > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/clocks', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given invalid JSON > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/clocks', {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });
});
