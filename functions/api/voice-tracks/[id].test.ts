import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the session module BEFORE importing the handler.
vi.mock('../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestGet, onRequestPatch, onRequestDelete } from './[id]';
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

const buildR2 = (): {
  put: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  putCalls: { key: string }[];
  deleteCalls: { key: string }[];
} => {
  const putCalls: { key: string }[] = [];
  const deleteCalls: { key: string }[] = [];
  const put = vi.fn(async (key: string) => {
    putCalls.push({ key });
    return { etag: 'x' };
  });
  const del = vi.fn(async (key: string) => {
    deleteCalls.push({ key });
  });
  return { put, del, putCalls, deleteCalls };
};

const buildEnv = (
  allResults: AllResult[],
  firstResults: (unknown | null)[] = [],
): {
  env: SonicBloomEnv;
  mockDb: ReturnType<typeof buildD1>;
  mockR2: ReturnType<typeof buildR2>;
} => {
  const mockDb = buildD1(allResults, firstResults);
  const mockR2 = buildR2();
  const env = {
    DB: mockDb,
    MEDIA_BUCKET: { put: mockR2.put, delete: mockR2.del },
    AUTH_JWT_SECRET: 'test-secret',
  } as unknown as SonicBloomEnv;
  return { env, mockDb, mockR2 };
};

const buildRequest = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

const voiceTrackRow = {
  id: 'vt-1',
  station_id: 'urban-radio',
  recorded_by: 'user-1',
  storage_key: 'stations/urban-radio/voice-tracks/vt-1.mp3',
  duration_ms: 12000,
  transcript: 'Hello listeners',
  target_clock_slot_id: null,
  status: 'draft',
  ai_generated: 0,
  created_at: '2026-05-14T10:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/voice-tracks/:id', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/voice-tracks/vt-1'),
      params: { id: 'vt-1' },
    });
    expect(res.status).toBe(401);
  });

  test('given no station membership > 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [], success: true }]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/voice-tracks/vt-1'),
      params: { id: 'vt-1' },
    });
    expect(res.status).toBe(403);
  });

  test('given valid id > 200 with voiceTrack and streamUrl', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv(
      [{ results: [memberRow], success: true }],
      [voiceTrackRow],
    );
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/voice-tracks/vt-1'),
      params: { id: 'vt-1' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      voiceTrack: { id: string; stationId: string; streamUrl: string };
    };
    expect(body.voiceTrack.id).toBe('vt-1');
    expect(body.voiceTrack.stationId).toBe('urban-radio');
    expect(body.voiceTrack.streamUrl).toBe('/api/voice-tracks/vt-1/stream');
  });

  test('given cross-station id > 404', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv([{ results: [memberRow], success: true }], [null]);
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/voice-tracks/vt-X'),
      params: { id: 'vt-X' },
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/voice-tracks/:id', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/voice-tracks/vt-1', {
        method: 'PATCH',
        body: JSON.stringify({ transcript: 'Updated' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'vt-1' },
    });
    expect(res.status).toBe(401);
  });

  test('given cross-station id > 404, no UPDATE issued', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv(
      [{ results: [memberRow], success: true }],
      [null], // existing row -> null
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/voice-tracks/vt-X', {
        method: 'PATCH',
        body: JSON.stringify({ transcript: 'X' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'vt-X' },
    });
    expect(res.status).toBe(404);
    const updateStmt = mockDb.preparedStatements.find((s) =>
      /UPDATE voice_tracks/i.test(s.sql),
    );
    expect(updateStmt).toBeUndefined();
  });

  test('PATCH transcript-only > only transcript field updated', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv(
      [{ results: [memberRow], success: true }],
      [voiceTrackRow, { ...voiceTrackRow, transcript: 'New transcript' }],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/voice-tracks/vt-1', {
        method: 'PATCH',
        body: JSON.stringify({ transcript: 'New transcript' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'vt-1' },
    });
    expect(res.status).toBe(200);
    const updateStmt = mockDb.preparedStatements.find((s) =>
      /UPDATE voice_tracks/i.test(s.sql),
    );
    expect(updateStmt).toBeDefined();
    expect(updateStmt!.sql).toMatch(/SET transcript = \?/);
    expect(updateStmt!.sql).not.toMatch(/status = \?/);
    expect(updateStmt!.binds).toContain('New transcript');
  });

  test('PATCH status=ready > succeeds and writes audit_log update', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv(
      [{ results: [memberRow], success: true }],
      [voiceTrackRow, { ...voiceTrackRow, status: 'ready' }],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/voice-tracks/vt-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ready' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'vt-1' },
    });
    expect(res.status).toBe(200);
    const updateStmt = mockDb.preparedStatements.find((s) =>
      /UPDATE voice_tracks/i.test(s.sql),
    );
    expect(updateStmt!.binds).toContain('ready');
    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('update');
    expect(auditStmt!.binds).toContain('voice_track');
  });

  test('PATCH status=bogus > 400 Zod validation', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv(
      [{ results: [memberRow], success: true }],
      [voiceTrackRow],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/voice-tracks/vt-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'bogus' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'vt-1' },
    });
    expect(res.status).toBe(400);
  });

  test('PATCH with empty body > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv(
      [{ results: [memberRow], success: true }],
      [voiceTrackRow],
    );
    const res = await onRequestPatch({
      env,
      request: buildRequest('/api/voice-tracks/vt-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'vt-1' },
    });
    expect(res.status).toBe(400);
  });

  test('audit_log records before+after on patch', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const updatedRow = { ...voiceTrackRow, status: 'aired' };
    const { env, mockDb } = buildEnv(
      [{ results: [memberRow], success: true }],
      [voiceTrackRow, updatedRow],
    );
    await onRequestPatch({
      env,
      request: buildRequest('/api/voice-tracks/vt-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'aired' }),
        headers: { 'content-type': 'application/json' },
      }),
      params: { id: 'vt-1' },
    });
    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    // before_json and after_json should both be set strings (not null)
    const beforeJsonBind = auditStmt!.binds.find(
      (b) => typeof b === 'string' && b.includes('"status":"draft"'),
    );
    const afterJsonBind = auditStmt!.binds.find(
      (b) => typeof b === 'string' && b.includes('"status":"aired"'),
    );
    expect(beforeJsonBind).toBeDefined();
    expect(afterJsonBind).toBeDefined();
  });
});

describe('DELETE /api/voice-tracks/:id', () => {
  test('given no session > 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv([]);
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/voice-tracks/vt-1', { method: 'DELETE' }),
      params: { id: 'vt-1' },
    });
    expect(res.status).toBe(401);
  });

  test('given cross-station id > 404, no R2 delete', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockR2 } = buildEnv(
      [{ results: [memberRow], success: true }],
      [null],
    );
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/voice-tracks/vt-X', { method: 'DELETE' }),
      params: { id: 'vt-X' },
    });
    expect(res.status).toBe(404);
    expect(mockR2.deleteCalls).toHaveLength(0);
  });

  test('given valid > 200 + R2.delete called + D1 delete + audit_log before snapshot', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb, mockR2 } = buildEnv(
      [{ results: [memberRow], success: true }],
      [voiceTrackRow],
    );
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/voice-tracks/vt-1', { method: 'DELETE' }),
      params: { id: 'vt-1' },
    });
    expect(res.status).toBe(200);

    // R2.delete called with the row's storage_key
    expect(mockR2.deleteCalls).toHaveLength(1);
    expect(mockR2.deleteCalls[0].key).toBe(voiceTrackRow.storage_key);

    // D1 DELETE happened
    const delStmt = mockDb.preparedStatements.find((s) =>
      /DELETE FROM voice_tracks/i.test(s.sql),
    );
    expect(delStmt).toBeDefined();
    expect(delStmt!.binds).toContain('vt-1');
    expect(delStmt!.binds).toContain('urban-radio');

    // audit_log with before snapshot
    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('delete');
    expect(auditStmt!.binds).toContain('voice_track');
    const beforeJsonBind = auditStmt!.binds.find(
      (b) => typeof b === 'string' && b.includes('"id":"vt-1"'),
    );
    expect(beforeJsonBind).toBeDefined();
  });

  test('R2.delete failure does not block DB delete or return 5xx', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb, mockR2 } = buildEnv(
      [{ results: [memberRow], success: true }],
      [voiceTrackRow],
    );
    mockR2.del.mockImplementationOnce(async () => {
      throw new Error('r2 transient');
    });
    const res = await onRequestDelete({
      env,
      request: buildRequest('/api/voice-tracks/vt-1', { method: 'DELETE' }),
      params: { id: 'vt-1' },
    });
    // We still complete the DB delete + audit log even if the R2 delete fails;
    // a janitor job can sweep orphaned R2 objects later. 200 keeps the API
    // contract consistent — the row is gone from the user's perspective.
    expect(res.status).toBe(200);
    const delStmt = mockDb.preparedStatements.find((s) =>
      /DELETE FROM voice_tracks/i.test(s.sql),
    );
    expect(delStmt).toBeDefined();
  });
});
