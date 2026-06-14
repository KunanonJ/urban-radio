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

const buildRequest = (path = '/api/schedule', init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

const scheduleRow = {
  id: 'sched-1',
  station_id: 'urban-radio',
  clock_id: 'clk-1',
  weekday: 1,
  hour: 10,
  valid_from: null,
  valid_until: null,
  rrule: null,
  created_at: '2026-05-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/schedule', () => {
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

  test('given valid session > returns assignments scoped to station', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [scheduleRow], success: true },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      assignments: { id: string; clockId: string; weekday: number; hour: number }[];
    };
    expect(body.assignments).toHaveLength(1);
    expect(body.assignments[0].id).toBe('sched-1');
    expect(body.assignments[0].clockId).toBe('clk-1');
    expect(body.assignments[0].weekday).toBe(1);
    expect(body.assignments[0].hour).toBe(10);
    const stmt = mockDb.preparedStatements.find((s) => /FROM schedule_assignments/.test(s.sql));
    expect(stmt).toBeDefined();
    expect(stmt!.binds[0]).toBe('urban-radio');
  });

  test('given weekday + hour filter > narrows query', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    await onRequestGet({
      env,
      request: buildRequest('/api/schedule?weekday=1&hour=10'),
    });
    const stmt = mockDb.preparedStatements.find((s) => /FROM schedule_assignments/.test(s.sql));
    expect(stmt).toBeDefined();
    expect(stmt!.binds).toContain(1);
    expect(stmt!.binds).toContain(10);
  });
});

describe('POST /api/schedule', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({ clockId: 'c1', weekday: 1, hour: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(401);
  });

  test('given valid body > 201 + audit_log call', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // [0] member lookup, [1] overlap lookup -> empty
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({ clockId: 'clk-1', weekday: 1, hour: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { assignment: { id: string; clockId: string } };
    expect(body.assignment.clockId).toBe('clk-1');
    expect(typeof body.assignment.id).toBe('string');

    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO schedule_assignments/i.test(s.sql),
    );
    expect(insertStmt).toBeDefined();
    expect(insertStmt!.binds).toContain('clk-1');
    expect(insertStmt!.binds).toContain('urban-radio');

    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('urban-radio');
    expect(auditStmt!.binds).toContain('user-1');
    expect(auditStmt!.binds).toContain('create');
    expect(auditStmt!.binds).toContain('schedule_assignment');
  });

  test('given weekday=7 > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({ clockId: 'clk-1', weekday: 7, hour: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/weekday/i);
  });

  test('given hour=24 > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({ clockId: 'clk-1', weekday: 1, hour: 24 }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/hour/i);
  });

  test('given missing clockId > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({ weekday: 1, hour: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given invalid JSON > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/schedule', {
        method: 'POST',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given invalid rrule > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({
          clockId: 'clk-1',
          weekday: 1,
          hour: 10,
          rrule: 'FREQ=GIBBERISH',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/rrule/i);
  });

  test('given overlap exists, no force > 409 with conflicts list', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // [0] member lookup, [1] overlap lookup -> returns existing
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [scheduleRow], success: true },
    ]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({ clockId: 'clk-other', weekday: 1, hour: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      conflicts: { id: string; clockId: string }[];
    };
    expect(body.error).toBe('overlap');
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].id).toBe('sched-1');
  });

  test('given overlap exists, force=1 > 201 (overwrites)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // [0] member lookup, [1] overlap lookup -> returns existing
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [scheduleRow], success: true },
    ]);
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/schedule?force=1', {
        method: 'POST',
        body: JSON.stringify({ clockId: 'clk-other', weekday: 1, hour: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      assignment: { id: string; clockId: string };
      overrode: { id: string }[];
    };
    expect(body.assignment.clockId).toBe('clk-other');
    expect(body.overrode).toHaveLength(1);
    expect(body.overrode[0].id).toBe('sched-1');
    // Conflict row should have been deleted
    const deleteStmt = mockDb.preparedStatements.find((s) =>
      /DELETE FROM schedule_assignments/i.test(s.sql),
    );
    expect(deleteStmt).toBeDefined();
    expect(deleteStmt!.binds).toContain('sched-1');
  });
});
