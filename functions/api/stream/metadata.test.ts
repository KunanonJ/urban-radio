import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestPost } from './metadata';
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

const buildRequest = (body: unknown, contentType = 'application/json') => {
  const headers = new Headers({ 'content-type': contentType });
  headers.set('cookie', 'sb_session=valid-token');
  return new Request('http://localhost/api/stream/metadata', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
};

const okSession = { sub: 'user-1', username: 'demo' };
const producerMember = { station_id: 'urban-radio', role: 'producer' };

beforeEach(() => {
  vi.clearAllMocks();
  __resetStubStreamControlForTests();
});

describe('POST /api/stream/metadata', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestPost({
      env,
      request: buildRequest({ title: 'Song A' }),
    });
    expect(res.status).toBe(401);
  });

  test('given invalid body (no title) > returns 400 (Zod)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [producerMember], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest({ artist: 'A' }),
    });
    expect(res.status).toBe(400);
  });

  test('given invalid JSON > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [producerMember], success: true }]);
    const res = await onRequestPost({ env, request: buildRequest('not-json') });
    expect(res.status).toBe(400);
  });

  test('given valid metadata > 200, writes audit_log AND play_log', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([{ results: [producerMember], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest({ title: 'Song A', artist: 'Artist A', album: 'Album A' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('stream_metadata');
    expect(auditStmt!.binds).toContain('station');

    const playLogStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO play_log/i.test(s.sql),
    );
    expect(playLogStmt).toBeDefined();
    expect(playLogStmt!.binds).toContain('urban-radio');
    expect(playLogStmt!.binds).toContain('Song A');
    expect(playLogStmt!.binds).toContain('Artist A');
  });

  test('given guest_vt role > 403 forbidden', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const guestMember = { station_id: 'urban-radio', role: 'guest_vt' };
    const { env } = buildEnv([{ results: [guestMember], success: true }]);
    const res = await onRequestPost({
      env,
      request: buildRequest({ title: 'X' }),
    });
    expect(res.status).toBe(403);
  });
});
