import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the session module BEFORE importing the handler.
vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet, onRequestPatch } from './me';
import { getSessionFromRequest } from '../../_lib/session-jwt';
import type { SonicBloomEnv } from '../../_lib/env';

type AllResult = { results: unknown[]; success?: boolean };

interface FirstResultMap {
  // optional list of canned first() responses in order
  first?: (unknown | null)[];
}

const buildD1 = (
  allResults: AllResult[] = [],
  firstResults: (unknown | null)[] = [],
): {
  prepare: ReturnType<typeof vi.fn>;
  preparedStatements: { sql: string; binds: unknown[] }[];
} => {
  const preparedStatements: { sql: string; binds: unknown[] }[] = [];
  let allIdx = 0;
  let firstIdx = 0;
  const prepare = vi.fn((sql: string) => {
    const stmt = { sql, binds: [] as unknown[] };
    preparedStatements.push(stmt);
    const chain = {
      bind: (...args: unknown[]) => {
        stmt.binds.push(...args);
        return chain;
      },
      all: vi.fn().mockImplementation(() => {
        const res = allResults[allIdx] ?? { results: [], success: true };
        allIdx += 1;
        return Promise.resolve(res);
      }),
      first: vi.fn().mockImplementation(() => {
        const res = firstResults[firstIdx] ?? null;
        firstIdx += 1;
        return Promise.resolve(res);
      }),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    return chain;
  });
  return { prepare, preparedStatements };
};

const buildEnv = (
  allResults: AllResult[] = [],
  firstResults: (unknown | null)[] = [],
): { env: SonicBloomEnv; mockDb: ReturnType<typeof buildD1> } => {
  const mockDb = buildD1(allResults, firstResults);
  return {
    env: { DB: mockDb, AUTH_JWT_SECRET: 'test-secret' } as unknown as SonicBloomEnv,
    mockDb,
  };
};

const buildRequest = (path = '/api/stations/me', init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const adminMember = { station_id: 'urban-radio', role: 'admin' };
const producerMember = { station_id: 'urban-radio', role: 'producer' };
const operatorMember = { station_id: 'urban-radio', role: 'operator' };
const guestMember = { station_id: 'urban-radio', role: 'guest_vt' };

const stationRow = {
  id: 'urban-radio',
  org_id: 'org-1',
  slug: 'urban-radio',
  name: 'Urban Radio',
  timezone: 'Asia/Bangkok',
  stream_url: 'https://stream.example.com/live',
  language: 'en',
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/stations/me', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv();
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(401);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(403);
  });

  test('given valid session > returns the station row in camelCase', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [adminMember], success: true },
      { results: [stationRow], success: true },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { station: Record<string, unknown> };
    expect(body.station).toEqual({
      id: 'urban-radio',
      orgId: 'org-1',
      slug: 'urban-radio',
      name: 'Urban Radio',
      timezone: 'Asia/Bangkok',
      streamUrl: 'https://stream.example.com/live',
      language: 'en',
      createdAt: '2026-01-01T00:00:00Z',
    });
    const stmt = mockDb.preparedStatements.find((s) => /FROM stations/.test(s.sql));
    expect(stmt).toBeDefined();
    expect(stmt!.binds[0]).toBe('urban-radio');
  });

  test('given station row missing > returns 404', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [adminMember], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/stations/me', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv();
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/stations/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'X' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(401);
  });

  test('given guest_vt role > returns 403 with Insufficient role error', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [guestMember], success: true }]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/stations/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'X' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/role/i);
  });

  test('given operator role > returns 403 (only admin/producer can edit identity)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [operatorMember], success: true }]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/stations/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'X' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(403);
  });

  test('given empty patch {} > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [adminMember], success: true }]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/stations/me', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given invalid JSON > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [adminMember], success: true }]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/stations/me', {
        method: 'PATCH',
        body: 'not json',
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given bad timezone > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [adminMember], success: true }]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/stations/me', {
        method: 'PATCH',
        body: JSON.stringify({ timezone: 'Mordor/Barad-dur' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given bad language code > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [adminMember], success: true }]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/stations/me', {
        method: 'PATCH',
        body: JSON.stringify({ language: '1234' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given admin + valid patch > 200 + UPDATE stations + audit_log + returns updated row', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const updatedRow = {
      ...stationRow,
      name: 'Urban Radio v2',
      timezone: 'America/New_York',
    };
    const { env, mockDb } = buildEnv([
      { results: [adminMember], success: true }, // station membership
      { results: [stationRow], success: true }, // before
      { results: [updatedRow], success: true }, // after
    ]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/stations/me', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Urban Radio v2',
          timezone: 'America/New_York',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { station: { name: string; timezone: string } };
    expect(body.station.name).toBe('Urban Radio v2');
    expect(body.station.timezone).toBe('America/New_York');

    const updateStmt = mockDb.preparedStatements.find((s) =>
      /UPDATE stations/i.test(s.sql),
    );
    expect(updateStmt).toBeDefined();
    expect(updateStmt!.binds).toContain('Urban Radio v2');
    expect(updateStmt!.binds).toContain('America/New_York');
    // station id is bound last in the UPDATE
    expect(updateStmt!.binds[updateStmt!.binds.length - 1]).toBe('urban-radio');

    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('urban-radio');
    expect(auditStmt!.binds).toContain('user-1');
    expect(auditStmt!.binds).toContain('update');
    expect(auditStmt!.binds).toContain('station');
  });

  test('given producer + streamUrl=null > updates with NULL', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const updatedRow = { ...stationRow, stream_url: null };
    const { env, mockDb } = buildEnv([
      { results: [producerMember], success: true },
      { results: [stationRow], success: true },
      { results: [updatedRow], success: true },
    ]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/stations/me', {
        method: 'PATCH',
        body: JSON.stringify({ streamUrl: null }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(200);
    const updateStmt = mockDb.preparedStatements.find((s) =>
      /UPDATE stations/i.test(s.sql),
    );
    expect(updateStmt).toBeDefined();
    expect(updateStmt!.binds[0]).toBeNull();
  });

  test('given name too long > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [adminMember], success: true }]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/stations/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'x'.repeat(200) }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });
});
