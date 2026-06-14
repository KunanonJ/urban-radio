import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the session module BEFORE importing the handler.
vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet } from './index';
import { getSessionFromRequest } from '../../_lib/session-jwt';
import type { SonicBloomEnv } from '../../_lib/env';

type AllResult = { results: unknown[]; success?: boolean };

const buildD1 = (allResults: AllResult[]) => {
  const preparedStatements: { sql: string; binds: unknown[] }[] = [];
  let allCallIdx = 0;
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
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn().mockResolvedValue({ success: true }),
    };
    return chain;
  });
  return { prepare, preparedStatements };
};

const buildEnv = (allResults: AllResult[]) => {
  const mockDb = buildD1(allResults);
  return {
    env: { DB: mockDb, AUTH_JWT_SECRST: 'unused', AUTH_JWT_SECRET: 'test-secret' } as unknown as SonicBloomEnv,
    mockDb,
  };
};

const buildRequest = (path = '/api/audit-log', init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

function makeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'audit-1',
    station_id: 'urban-radio',
    actor_user_id: 'user-1',
    action: 'create',
    target_type: 'clock',
    target_id: 'clock-1',
    before_json: null,
    after_json: JSON.stringify({ name: 'A' }),
    at: '2026-05-13T10:00:00Z',
    actor_username: 'demo',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/audit-log (JSON list)', () => {
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

  test('given valid session > returns shaped entries with parsed before/after objects', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      {
        results: [
          makeRow({
            id: 'audit-1',
            action: 'update',
            before_json: JSON.stringify({ name: 'Old' }),
            after_json: JSON.stringify({ name: 'New' }),
          }),
        ],
        success: true,
      },
    ]);

    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: {
        id: string;
        at: string;
        actor: { userId: string | null; username: string | null };
        action: string;
        targetType: string;
        targetId: string;
        before: unknown;
        after: unknown;
      }[];
      meta: { nextCursor: string | null; limit: number };
    };
    expect(body.entries).toHaveLength(1);
    const [entry] = body.entries;
    expect(entry.id).toBe('audit-1');
    expect(entry.action).toBe('update');
    expect(entry.actor.userId).toBe('user-1');
    expect(entry.actor.username).toBe('demo');
    // Server parses JSON columns so the UI gets objects, not strings.
    expect(entry.before).toEqual({ name: 'Old' });
    expect(entry.after).toEqual({ name: 'New' });
    // station_id must be the first bind on the audit_log query.
    const listStmt = mockDb.preparedStatements.find((s) => /FROM audit_log/.test(s.sql));
    expect(listStmt).toBeDefined();
    expect(listStmt!.binds[0]).toBe('urban-radio');
  });

  test('surfaces actor.username via JOIN, falling back to null when user is deleted', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      {
        results: [
          makeRow({ id: 'a1', actor_user_id: null, actor_username: null }),
        ],
        success: true,
      },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    const body = (await res.json()) as {
      entries: { actor: { userId: string | null; username: string | null } }[];
    };
    expect(body.entries[0].actor.userId).toBeNull();
    expect(body.entries[0].actor.username).toBeNull();
  });

  test('?actorUserId + ?action + ?targetType + ?from + ?to > forwards filter binds', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest(
        '/api/audit-log?actorUserId=u9&action=update&targetType=clock&from=2026-01-01T00:00:00Z&to=2026-02-01T00:00:00Z',
      ),
    });
    expect(res.status).toBe(200);
    const listStmt = mockDb.preparedStatements.find((s) => /FROM audit_log/.test(s.sql));
    expect(listStmt!.binds).toContain('u9');
    expect(listStmt!.binds).toContain('update');
    expect(listStmt!.binds).toContain('clock');
    expect(listStmt!.binds).toContain('2026-01-01T00:00:00Z');
    expect(listStmt!.binds).toContain('2026-02-01T00:00:00Z');
  });

  test('?search > forwards LIKE clause with wildcard-wrapped bind', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/audit-log?search=morning'),
    });
    expect(res.status).toBe(200);
    const listStmt = mockDb.preparedStatements.find((s) => /FROM audit_log/.test(s.sql));
    expect(listStmt!.sql).toMatch(/LIKE/i);
    const wildcard = listStmt!.binds.find(
      (b) => typeof b === 'string' && (b as string).includes('morning') && (b as string).startsWith('%'),
    );
    expect(wildcard).toBeDefined();
  });

  test('?cursor=X > forwards decoded keyset cursor binds', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const cursor = Buffer.from(
      JSON.stringify({ lastAt: '2026-05-13T10:00:00Z', lastId: 'audit-1' }),
      'utf8',
    ).toString('base64url');
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest(`/api/audit-log?cursor=${cursor}`),
    });
    expect(res.status).toBe(200);
    const listStmt = mockDb.preparedStatements.find((s) => /FROM audit_log/.test(s.sql));
    expect(listStmt!.binds).toContain('2026-05-13T10:00:00Z');
    expect(listStmt!.binds).toContain('audit-1');
  });

  test('returns meta.nextCursor when results fill the page', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [makeRow({ id: 'a1' })], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/audit-log?limit=1'),
    });
    const body = (await res.json()) as { meta: { nextCursor: string | null; limit: number } };
    expect(body.meta.limit).toBe(1);
    expect(typeof body.meta.nextCursor).toBe('string');
    expect(body.meta.nextCursor).not.toBeNull();
  });

  test('caller cannot spoof station_id via query — gate context wins', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    await onRequestGet({
      env,
      request: buildRequest('/api/audit-log?stationId=other-station&station_id=other-station'),
    });
    const listStmt = mockDb.preparedStatements.find((s) => /FROM audit_log/.test(s.sql));
    expect(listStmt!.binds[0]).toBe('urban-radio');
    expect(listStmt!.binds).not.toContain('other-station');
  });

  test('audit_log_export rows are included in normal list output (transparent self-audit)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      {
        results: [
          makeRow({
            id: 'export-1',
            action: 'audit_log_export',
            target_type: 'station',
            target_id: 'urban-radio',
            after_json: JSON.stringify({ format: 'csv', rowCount: 12 }),
          }),
        ],
        success: true,
      },
    ]);
    const res = await onRequestGet({ env, request: buildRequest() });
    const body = (await res.json()) as { entries: { action: string }[] };
    expect(body.entries.map((e) => e.action)).toContain('audit_log_export');
  });
});

describe('GET /api/audit-log?format=csv (CSV export)', () => {
  test('returns text/csv with header row', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/audit-log?format=csv'),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/csv/i);
    const text = await res.text();
    expect(text.split('\n')[0]).toBe('At,Actor,Action,TargetType,TargetId,Before,After');
  });

  test('emits one CSV row per audit_log row, RFC 4180 escaped for embedded JSON', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      {
        results: [
          makeRow({
            id: 'a1',
            action: 'update',
            // before_json contains a literal comma — must force CSV quoting.
            before_json: '{"name":"Old, Name"}',
            // after_json contains a literal " — must be doubled to "" inside the quoted field.
            after_json: '{"name":"Q1"}',
          }),
        ],
        success: true,
      },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/audit-log?format=csv'),
    });
    const text = await res.text();
    const lines = text.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(2); // header + 1 row
    // Embedded comma forces quoting around the field.
    expect(text).toContain('"{""name"":""Old, Name""}"');
    // All internal " in the JSON payload are doubled to "" per RFC 4180.
    expect(text).toContain('""name""');
  });

  test('CSV path honors filters', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [], success: true },
    ]);
    await onRequestGet({
      env,
      request: buildRequest('/api/audit-log?format=csv&action=create&targetType=clock'),
    });
    const listStmt = mockDb.preparedStatements.find((s) => /FROM audit_log/.test(s.sql));
    expect(listStmt!.sql).toMatch(/action = \?/);
    expect(listStmt!.sql).toMatch(/target_type = \?/);
    expect(listStmt!.binds).toContain('create');
    expect(listStmt!.binds).toContain('clock');
  });

  test('CSV writes one audit_log_export row before responding', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv([
      { results: [memberRow], success: true },
      { results: [makeRow({ id: 'a1' })], success: true },
    ]);
    await onRequestGet({
      env,
      request: buildRequest('/api/audit-log?format=csv'),
    });
    // writeAuditLog goes through prepare(INSERT INTO audit_log ...) on its own row.
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(insertStmt).toBeDefined();
    // Action should be `audit_log_export`.
    expect(insertStmt!.binds).toContain('audit_log_export');
  });

  test('CSV 413 when row cap exceeded', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // Simulate overflow: builder asks for rowCap + 1; return rowCap + 1 rows.
    const overflowRows = Array.from({ length: 50_001 }, (_, i) =>
      makeRow({ id: `a${i}` }),
    );
    const { env } = buildEnv([
      { results: [memberRow], success: true },
      { results: overflowRows, success: true },
    ]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/audit-log?format=csv'),
    });
    expect(res.status).toBe(413);
  });

  test('CSV requires auth (401 with no session)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/audit-log?format=csv'),
    });
    expect(res.status).toBe(401);
  });
});
