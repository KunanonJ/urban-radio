import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestPost } from './start';
import { getSessionFromRequest } from '../../_lib/session-jwt';
import { __resetStubStreamControlForTests } from '../../_lib/stream-control';
import type { SonicBloomEnv } from '../../_lib/env';

type AllResult = { results: unknown[]; success?: boolean };

const buildD1 = (allResults: AllResult[]) => {
  const preparedStatements: { sql: string; binds: unknown[] }[] = [];
  let idx = 0;
  const prepare = vi.fn((sql: string) => {
    const stmt = { sql, binds: [] as unknown[] };
    preparedStatements.push(stmt);
    const chain = {
      bind: (...args: unknown[]) => {
        stmt.binds.push(...args);
        return chain;
      },
      all: vi.fn().mockImplementation(() => {
        const res = allResults[idx] ?? { results: [], success: true };
        idx += 1;
        return Promise.resolve(res);
      }),
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

const buildRequest = () => {
  const headers = new Headers();
  headers.set('cookie', 'sb_session=valid-token');
  return new Request('http://localhost/api/stream/start', { method: 'POST', headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const adminMember = { station_id: 'urban-radio', role: 'admin' };

beforeEach(() => {
  vi.clearAllMocks();
  __resetStubStreamControlForTests();
});

describe('POST /api/stream/start', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestPost({ env, request: buildRequest() });
    expect(res.status).toBe(401);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await onRequestPost({ env, request: buildRequest() });
    expect(res.status).toBe(403);
  });

  test('given admin > starts stream, returns 200 with status, writes audit_log', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([{ results: [adminMember], success: true }]);
    const res = await onRequestPost({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      status: { connected: boolean; source: string };
    };
    expect(body.ok).toBe(true);
    expect(body.status.connected).toBe(true);
    expect(body.status.source).toBe('stub');

    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('urban-radio');
    expect(auditStmt!.binds).toContain('user-1');
    expect(auditStmt!.binds).toContain('stream_start');
    expect(auditStmt!.binds).toContain('station');
  });

  test('given guest_vt role > forbids start with 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const guestMember = { station_id: 'urban-radio', role: 'guest_vt' };
    const { env } = buildEnv([{ results: [guestMember], success: true }]);
    const res = await onRequestPost({ env, request: buildRequest() });
    expect(res.status).toBe(403);
  });

  test('idempotent: starting an already-started stream returns 200 / connected=true', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // Two separate calls, each gets its own membership lookup row.
    const { env: env1 } = buildEnv([{ results: [adminMember], success: true }]);
    const { env: env2 } = buildEnv([{ results: [adminMember], success: true }]);
    const first = await onRequestPost({ env: env1, request: buildRequest() });
    expect(first.status).toBe(200);
    const second = await onRequestPost({ env: env2, request: buildRequest() });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { ok: boolean; status: { connected: boolean } };
    expect(body.ok).toBe(true);
    expect(body.status.connected).toBe(true);
  });
});
