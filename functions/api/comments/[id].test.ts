import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestPatch, onRequestDelete } from './[id]';
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
  firstResults: (unknown | null)[] = [],
): {
  prepare: ReturnType<typeof vi.fn>;
  preparedStatements: PreparedStatement[];
} => {
  const preparedStatements: PreparedStatement[] = [];
  let allCallIdx = 0;
  let firstCallIdx = 0;
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
      first: vi.fn().mockImplementation(() => {
        const res = firstResults[firstCallIdx] ?? null;
        firstCallIdx += 1;
        return Promise.resolve(res);
      }),
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
  allResults: AllResult[],
  firstResults: (unknown | null)[] = [],
): { env: SonicBloomEnv; mockDb: ReturnType<typeof buildD1> } => {
  const mockDb = buildD1(allResults, firstResults);
  const env = {
    DB: mockDb,
    AUTH_JWT_SECRET: 'test-secret',
  } as unknown as SonicBloomEnv;
  return { env, mockDb };
};

const buildRequest = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const otherSession = { sub: 'user-2', username: 'other' };
const adminMember = { station_id: 'urban-radio', role: 'admin' };
const operatorMember = { station_id: 'urban-radio', role: 'operator' };
const producerMember = { station_id: 'urban-radio', role: 'producer' };

const commentRow = {
  id: 'c-1',
  station_id: 'urban-radio',
  author_user_id: 'user-1',
  target_type: 'clock',
  target_id: 'clk-1',
  body: 'great clock',
  resolved_at: null,
  resolved_by_user_id: null,
  created_at: '2026-05-14T10:00:00Z',
  updated_at: '2026-05-14T10:00:00Z',
  author_username: 'demo',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/comments/:id', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/comments/c-1', {
        method: 'PATCH',
        body: JSON.stringify({ body: 'edited' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(401);
  });

  test('cross-station id > 404, no UPDATE issued', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([{ results: [adminMember], success: true }], [null]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/comments/c-X', {
        method: 'PATCH',
        body: JSON.stringify({ body: 'X' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c-X' },
    });
    expect(res.status).toBe(404);
    const updateStmt = mockDb.preparedStatements.find((s) => /UPDATE comments/i.test(s.sql));
    expect(updateStmt).toBeUndefined();
  });

  test('author edits body > 200 + UPDATE + audit_log update', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const updated = { ...commentRow, body: 'edited' };
    const { env, mockDb } = buildEnv(
      [{ results: [adminMember], success: true }],
      [commentRow, updated],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/comments/c-1', {
        method: 'PATCH',
        body: JSON.stringify({ body: 'edited' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(200);
    const updateStmt = mockDb.preparedStatements.find((s) => /UPDATE comments/i.test(s.sql));
    expect(updateStmt).toBeDefined();
    expect(updateStmt!.sql).toMatch(/SET body = \?/);
    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('update');
    expect(auditStmt!.binds).toContain('comment');
  });

  test('non-author with role=operator editing body > 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(otherSession);
    const { env, mockDb } = buildEnv(
      [{ results: [operatorMember], success: true }],
      [commentRow],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/comments/c-1', {
        method: 'PATCH',
        body: JSON.stringify({ body: 'sneaky edit' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(403);
    const updateStmt = mockDb.preparedStatements.find((s) => /UPDATE comments/i.test(s.sql));
    expect(updateStmt).toBeUndefined();
  });

  test('admin (non-author) resolving > 200 + sets resolved_at', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(otherSession);
    const updated = {
      ...commentRow,
      resolved_at: '2026-05-14T12:00:00Z',
      resolved_by_user_id: 'user-2',
    };
    const { env, mockDb } = buildEnv(
      [{ results: [adminMember], success: true }],
      [commentRow, updated],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/comments/c-1', {
        method: 'PATCH',
        body: JSON.stringify({ resolved: true }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(200);
    const updateStmt = mockDb.preparedStatements.find((s) => /UPDATE comments/i.test(s.sql));
    expect(updateStmt).toBeDefined();
    expect(updateStmt!.sql).toMatch(/resolved_at = \?/);
    expect(updateStmt!.sql).toMatch(/resolved_by_user_id = \?/);
  });

  test('producer (non-author) unresolving > 200 + clears resolved_at', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(otherSession);
    const resolved = {
      ...commentRow,
      resolved_at: '2026-05-14T11:00:00Z',
      resolved_by_user_id: 'user-1',
    };
    const unresolved = { ...commentRow };
    const { env, mockDb } = buildEnv(
      [{ results: [producerMember], success: true }],
      [resolved, unresolved],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/comments/c-1', {
        method: 'PATCH',
        body: JSON.stringify({ resolved: false }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(200);
    const updateStmt = mockDb.preparedStatements.find((s) => /UPDATE comments/i.test(s.sql));
    expect(updateStmt!.binds).toContain(null);
  });

  test('operator (non-author) resolving > 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(otherSession);
    const { env, mockDb } = buildEnv(
      [{ results: [operatorMember], success: true }],
      [commentRow],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/comments/c-1', {
        method: 'PATCH',
        body: JSON.stringify({ resolved: true }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(403);
    const updateStmt = mockDb.preparedStatements.find((s) => /UPDATE comments/i.test(s.sql));
    expect(updateStmt).toBeUndefined();
  });

  test('empty patch body > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv(
      [{ results: [adminMember], success: true }],
      [commentRow],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/comments/c-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/comments/:id', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/comments/c-1', { method: 'DELETE' }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(401);
  });

  test('cross-station id > 404 (no DELETE issued)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([{ results: [adminMember], success: true }], [null]);
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/comments/c-X', { method: 'DELETE' }),
      params: { id: 'c-X' },
    });
    expect(res.status).toBe(404);
    const delStmt = mockDb.preparedStatements.find((s) =>
      /DELETE FROM comments/i.test(s.sql),
    );
    expect(delStmt).toBeUndefined();
  });

  test('author deletes > 200 + DELETE + audit_log delete', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv(
      [{ results: [adminMember], success: true }],
      [commentRow],
    );
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/comments/c-1', { method: 'DELETE' }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(200);
    const delStmt = mockDb.preparedStatements.find((s) =>
      /DELETE FROM comments/i.test(s.sql),
    );
    expect(delStmt).toBeDefined();
    expect(delStmt!.binds).toContain('c-1');
    expect(delStmt!.binds).toContain('urban-radio');
    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt!.binds).toContain('delete');
    expect(auditStmt!.binds).toContain('comment');
  });

  test('non-author with role=operator > 403, no DELETE', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(otherSession);
    const { env, mockDb } = buildEnv(
      [{ results: [operatorMember], success: true }],
      [commentRow],
    );
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/comments/c-1', { method: 'DELETE' }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(403);
    const delStmt = mockDb.preparedStatements.find((s) =>
      /DELETE FROM comments/i.test(s.sql),
    );
    expect(delStmt).toBeUndefined();
  });

  test('admin (non-author) > 200 (admin override)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(otherSession);
    const { env, mockDb } = buildEnv(
      [{ results: [adminMember], success: true }],
      [commentRow],
    );
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/comments/c-1', { method: 'DELETE' }),
      params: { id: 'c-1' },
    });
    expect(res.status).toBe(200);
    const delStmt = mockDb.preparedStatements.find((s) =>
      /DELETE FROM comments/i.test(s.sql),
    );
    expect(delStmt).toBeDefined();
  });
});
