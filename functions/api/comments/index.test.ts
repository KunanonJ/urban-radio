import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the session module BEFORE importing the handler.
vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet, onRequestPost } from './index';
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
  opts: {
    allResults?: AllResult[];
    firstResults?: (unknown | null)[];
    secretSet?: boolean;
  } = {},
): { env: SonicBloomEnv; mockDb: ReturnType<typeof buildD1> } => {
  const { allResults = [], firstResults = [], secretSet = true } = opts;
  const mockDb = buildD1(allResults, firstResults);
  const env = {
    DB: mockDb,
    AUTH_JWT_SECRET: secretSet ? 'test-secret' : '',
  } as unknown as SonicBloomEnv;
  return { env, mockDb };
};

const buildRequest = (path = '/api/comments', init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

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

const resolvedRow = {
  ...commentRow,
  id: 'c-2',
  body: 'old issue',
  resolved_at: '2026-05-14T11:00:00Z',
  resolved_by_user_id: 'user-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/comments', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv();
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/comments?targetType=clock&targetId=clk-1'),
    });
    expect(res.status).toBe(401);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({ allResults: [{ results: [], success: true }] });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/comments?targetType=clock&targetId=clk-1'),
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
      request: buildRequest('/api/comments'),
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
      request: buildRequest('/api/comments?targetType=mystery&targetId=x'),
    });
    expect(res.status).toBe(400);
  });

  test('valid query > returns rows scoped to caller station', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [commentRow], success: true },
      ],
    });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/comments?targetType=clock&targetId=clk-1'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      comments: { id: string; stationId: string; author: { userId: string; username: string | null } }[];
      meta: { nextCursor: string | null; limit: number };
    };
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].id).toBe('c-1');
    expect(body.comments[0].stationId).toBe('urban-radio');
    expect(body.comments[0].author.userId).toBe('user-1');
    expect(body.comments[0].author.username).toBe('demo');

    const listStmt = mockDb.preparedStatements.find((s) => /FROM comments/.test(s.sql));
    expect(listStmt).toBeDefined();
    expect(listStmt!.binds).toContain('urban-radio');
    expect(listStmt!.binds).toContain('clock');
    expect(listStmt!.binds).toContain('clk-1');
  });

  test('default includeResolved=false hides resolved rows', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [], success: true },
      ],
    });
    await onRequestGet({
      env,
      request: buildRequest('/api/comments?targetType=clock&targetId=clk-1'),
    });
    const listStmt = mockDb.preparedStatements.find((s) => /FROM comments/.test(s.sql));
    expect(listStmt!.sql).toMatch(/resolved_at IS NULL/);
  });

  test('includeResolved=true does not add the resolved filter', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [resolvedRow], success: true },
      ],
    });
    await onRequestGet({
      env,
      request: buildRequest('/api/comments?targetType=clock&targetId=clk-1&includeResolved=true'),
    });
    const listStmt = mockDb.preparedStatements.find((s) => /FROM comments/.test(s.sql));
    expect(listStmt!.sql).not.toMatch(/resolved_at IS NULL/);
  });

  test('returns meta.nextCursor when page is full', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [commentRow], success: true },
      ],
    });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/comments?targetType=clock&targetId=clk-1&limit=1'),
    });
    const body = (await res.json()) as { meta: { nextCursor: string | null; limit: number } };
    expect(body.meta.limit).toBe(1);
    expect(typeof body.meta.nextCursor).toBe('string');
  });
});

describe('POST /api/comments', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv();
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/comments', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'clock', targetId: 'clk-1', body: 'hi' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(401);
  });

  test('given empty body > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/comments', {
        method: 'POST',
        body: JSON.stringify({ targetType: 'clock', targetId: 'clk-1', body: '   ' }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given body > 2000 chars > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/comments', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'clock',
          targetId: 'clk-1',
          body: 'x'.repeat(2001),
        }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given unknown targetType > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/comments', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'mystery',
          targetId: 'clk-1',
          body: 'hi',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('given valid payload > 201 + insert + audit_log + author info', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/comments', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'voice_track',
          targetId: 'vt-1',
          body: 'great take!',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      comment: {
        id: string;
        stationId: string;
        body: string;
        author: { userId: string; username: string | null };
        targetType: string;
        targetId: string;
      };
    };
    expect(body.comment.stationId).toBe('urban-radio');
    expect(body.comment.body).toBe('great take!');
    expect(body.comment.targetType).toBe('voice_track');
    expect(body.comment.targetId).toBe('vt-1');
    expect(body.comment.author.userId).toBe('user-1');

    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO comments/i.test(s.sql),
    );
    expect(insertStmt).toBeDefined();
    expect(insertStmt!.binds).toContain('urban-radio');
    expect(insertStmt!.binds).toContain('user-1');
    expect(insertStmt!.binds).toContain('voice_track');
    expect(insertStmt!.ran).toBe(true);

    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('create');
    expect(auditStmt!.binds).toContain('comment');
  });

  test('cross-station station_id in body is ignored — server uses gate stationId', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    await onRequestPost({
      env,
      request: buildRequest('/api/comments', {
        method: 'POST',
        body: JSON.stringify({
          targetType: 'clock',
          targetId: 'clk-1',
          body: 'hi',
          stationId: 'other-station',
          station_id: 'other-station',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO comments/i.test(s.sql),
    );
    expect(insertStmt!.binds).toContain('urban-radio');
    expect(insertStmt!.binds).not.toContain('other-station');
  });
});
