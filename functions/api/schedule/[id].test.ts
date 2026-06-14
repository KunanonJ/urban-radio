import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the session module BEFORE importing the handler.
vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet, onRequestPatch, onRequestDelete } from './[id]';
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

const buildRequest = (path: string, init: RequestInit = {}) => {
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

describe('GET /api/schedule/:id', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/schedule/sched-1'),
      params: { id: 'sched-1' },
    });
    expect(res.status).toBe(401);
  });

  test('given no station membership > 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/schedule/sched-1'),
      params: { id: 'sched-1' },
    });
    expect(res.status).toBe(403);
  });

  test('given valid id > 200 with assignment', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv(
      [{ results: [memberRow], success: true }],
      [scheduleRow],
    );
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/schedule/sched-1'),
      params: { id: 'sched-1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignment: { id: string; clockId: string } };
    expect(body.assignment.id).toBe('sched-1');
    expect(body.assignment.clockId).toBe('clk-1');
  });

  test('given not found > 404', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }], [null]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/schedule/nope'),
      params: { id: 'nope' },
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/schedule/:id', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/schedule/sched-1', {
        method: 'PATCH',
        body: JSON.stringify({ clockId: 'clk-2' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'sched-1' },
    });
    expect(res.status).toBe(401);
  });

  test('given cross-station > 404', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // [0] member lookup, first() for existing -> null (cross-station leak prevented)
    const { env } = buildEnv([{ results: [memberRow], success: true }], [null]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/schedule/sched-X', {
        method: 'PATCH',
        body: JSON.stringify({ clockId: 'clk-2' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'sched-X' },
    });
    expect(res.status).toBe(404);
  });

  test('given valid patch > 200 + audit_log', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // [0] member lookup, [1] overlap lookup -> empty after we re-fetch the updated row
    const { env, mockDb } = buildEnv(
      [
        { results: [memberRow], success: true },
        { results: [], success: true }, // overlap lookup empty
      ],
      [
        scheduleRow, // first() existing row before patch
        { ...scheduleRow, clock_id: 'clk-2' }, // first() updated row after patch
      ],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/schedule/sched-1', {
        method: 'PATCH',
        body: JSON.stringify({ clockId: 'clk-2' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'sched-1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { assignment: { id: string; clockId: string } };
    expect(body.assignment.clockId).toBe('clk-2');

    const updateStmt = mockDb.preparedStatements.find((s) =>
      /UPDATE schedule_assignments/i.test(s.sql),
    );
    expect(updateStmt).toBeDefined();
    expect(updateStmt!.binds).toContain('clk-2');

    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('update');
    expect(auditStmt!.binds).toContain('schedule_assignment');
  });

  test('given patch with overlap, no force > 409', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const conflictRow = { ...scheduleRow, id: 'sched-other', weekday: 2, hour: 10 };
    // [0] member lookup, [1] overlap lookup -> finds conflict
    const { env } = buildEnv(
      [
        { results: [memberRow], success: true },
        { results: [conflictRow], success: true },
      ],
      [scheduleRow],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/schedule/sched-1', {
        method: 'PATCH',
        body: JSON.stringify({ weekday: 2, hour: 10 }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'sched-1' },
    });
    expect(res.status).toBe(409);
  });

  test('given invalid weekday > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }], [scheduleRow]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/schedule/sched-1', {
        method: 'PATCH',
        body: JSON.stringify({ weekday: 99 }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'sched-1' },
    });
    expect(res.status).toBe(400);
  });

  test('given invalid rrule > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }], [scheduleRow]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/schedule/sched-1', {
        method: 'PATCH',
        body: JSON.stringify({ rrule: 'FREQ=GIBBERISH' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'sched-1' },
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/schedule/:id', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/schedule/sched-1', { method: 'DELETE' }),
      params: { id: 'sched-1' },
    });
    expect(res.status).toBe(401);
  });

  test('given cross-station > 404', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }], [null]);
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/schedule/sched-X', { method: 'DELETE' }),
      params: { id: 'sched-X' },
    });
    expect(res.status).toBe(404);
  });

  test('given valid > 200 + audit_log call with before snapshot', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv(
      [{ results: [memberRow], success: true }],
      [scheduleRow],
    );
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/schedule/sched-1', { method: 'DELETE' }),
      params: { id: 'sched-1' },
    });
    expect(res.status).toBe(200);

    const delStmt = mockDb.preparedStatements.find((s) =>
      /DELETE FROM schedule_assignments/i.test(s.sql),
    );
    expect(delStmt).toBeDefined();
    expect(delStmt!.binds).toContain('sched-1');

    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('delete');
    expect(auditStmt!.binds).toContain('schedule_assignment');
    // before snapshot should include the row JSON
    const beforeJsonBind = auditStmt!.binds.find(
      (b) => typeof b === 'string' && b.includes('"id":"sched-1"'),
    );
    expect(beforeJsonBind).toBeDefined();
  });
});
