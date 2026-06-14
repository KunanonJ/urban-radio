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

const buildR2 = (): {
  put: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  putCalls: { key: string; size: number }[];
  deleteCalls: { key: string }[];
} => {
  const putCalls: { key: string; size: number }[] = [];
  const deleteCalls: { key: string }[] = [];
  const put = vi.fn(async (key: string, body: ArrayBuffer | Uint8Array) => {
    const size =
      body instanceof ArrayBuffer
        ? body.byteLength
        : (body as Uint8Array | undefined)?.byteLength ?? 0;
    putCalls.push({ key, size });
    return { etag: 'x' };
  });
  const del = vi.fn(async (key: string) => {
    deleteCalls.push({ key });
  });
  return { put, del, putCalls, deleteCalls };
};

const buildEnv = (
  opts: {
    allResults?: AllResult[];
    firstResults?: (unknown | null)[];
    withR2?: boolean;
    secretSet?: boolean;
  } = {},
): {
  env: SonicBloomEnv;
  mockDb: ReturnType<typeof buildD1>;
  mockR2: ReturnType<typeof buildR2>;
} => {
  const { allResults = [], firstResults = [], withR2 = true, secretSet = true } = opts;
  const mockDb = buildD1(allResults, firstResults);
  const mockR2 = buildR2();
  const env = {
    DB: mockDb,
    MEDIA_BUCKET: withR2 ? { put: mockR2.put, delete: mockR2.del } : undefined,
    AUTH_JWT_SECRET: secretSet ? 'test-secret' : '',
  } as unknown as SonicBloomEnv;
  return { env, mockDb, mockR2 };
};

const buildRequest = (path = '/api/voice-tracks', init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  if (!headers.has('cookie')) headers.set('cookie', 'sb_session=valid-token');
  return new Request(`http://localhost${path}`, { ...init, headers });
};

/** Duck-typed Request with formData() since jsdom multipart parsing hangs. */
const buildMultipartRequest = (
  audio: Blob,
  meta: Record<string, unknown> | undefined | string,
  cookie: string | null = 'sb_session=valid-token',
): Request => {
  const fd = new FormData();
  fd.append('file', new File([audio], 'vt.mp3', { type: 'audio/mpeg' }));
  if (meta !== undefined) {
    fd.append('meta', typeof meta === 'string' ? meta : JSON.stringify(meta));
  }
  const headers = new Headers({ 'content-type': 'multipart/form-data; boundary=x' });
  if (cookie) headers.set('cookie', cookie);
  return {
    headers,
    url: 'http://localhost/api/voice-tracks',
    method: 'POST',
    formData: async () => fd,
  } as unknown as Request;
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

describe('GET /api/voice-tracks', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv();
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(401);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({ allResults: [{ results: [], success: true }] });
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(403);
  });

  test('given valid session > returns rows scoped to caller station', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [voiceTrackRow], success: true },
      ],
    });
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      voiceTracks: { id: string; stationId: string; storageKey: string }[];
      meta: { nextCursor: string | null; limit: number };
    };
    expect(body.voiceTracks).toHaveLength(1);
    expect(body.voiceTracks[0].id).toBe('vt-1');
    expect(body.voiceTracks[0].stationId).toBe('urban-radio');
    expect(body.meta.limit).toBe(50);
    const listStmt = mockDb.preparedStatements.find((s) => /FROM voice_tracks/.test(s.sql));
    expect(listStmt).toBeDefined();
    expect(listStmt!.binds[0]).toBe('urban-radio');
  });

  test('?status=ready > forwards status filter', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [], success: true },
      ],
    });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/voice-tracks?status=ready'),
    });
    expect(res.status).toBe(200);
    const listStmt = mockDb.preparedStatements.find((s) => /FROM voice_tracks/.test(s.sql));
    expect(listStmt!.sql).toMatch(/status = \?/);
    expect(listStmt!.binds).toContain('ready');
  });

  test('?targetClockSlotId > forwards filter bind', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [], success: true },
      ],
    });
    await onRequestGet({
      env,
      request: buildRequest('/api/voice-tracks?targetClockSlotId=slot-7'),
    });
    const listStmt = mockDb.preparedStatements.find((s) => /FROM voice_tracks/.test(s.sql));
    expect(listStmt!.sql).toMatch(/target_clock_slot_id = \?/);
    expect(listStmt!.binds).toContain('slot-7');
  });

  test('?status=bogus > 400 from validation', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/voice-tracks?status=bogus'),
    });
    expect(res.status).toBe(400);
  });

  test('returns meta.nextCursor when page is full', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [
        { results: [memberRow], success: true },
        { results: [voiceTrackRow], success: true },
      ],
    });
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/voice-tracks?limit=1'),
    });
    const body = (await res.json()) as { meta: { nextCursor: string | null; limit: number } };
    expect(body.meta.limit).toBe(1);
    expect(typeof body.meta.nextCursor).toBe('string');
  });
});

describe('POST /api/voice-tracks (multipart)', () => {
  test('given no session > returns 401 and no R2 write', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env, mockR2 } = buildEnv();
    const req = buildMultipartRequest(new Blob(['fake-bytes']), { durationMs: 1000 });
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(401);
    expect(mockR2.putCalls).toHaveLength(0);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({ allResults: [{ results: [], success: true }] });
    const req = buildMultipartRequest(new Blob(['fake-bytes']), { durationMs: 1000 });
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(403);
  });

  test('given missing audio file > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    // Build a multipart request with the meta field but no file field.
    const fd = new FormData();
    fd.append('meta', JSON.stringify({ durationMs: 1000 }));
    const req = {
      headers: new Headers({
        cookie: 'sb_session=valid-token',
        'content-type': 'multipart/form-data; boundary=x',
      }),
      url: 'http://localhost/api/voice-tracks',
      method: 'POST',
      formData: async () => fd,
    } as unknown as Request;
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(400);
  });

  test('given invalid meta JSON > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const req = buildMultipartRequest(new Blob(['fake-bytes']), 'not-json{');
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(400);
  });

  test('given negative durationMs > 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const req = buildMultipartRequest(new Blob(['fake-bytes']), { durationMs: -1 });
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(400);
  });

  test('given valid multipart > 201, R2 put + D1 insert + audit_log', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb, mockR2 } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const req = buildMultipartRequest(new Blob(['fake-bytes']), {
      durationMs: 12000,
      transcript: 'Hello listeners',
      status: 'ready',
    });
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      voiceTrack: { id: string; stationId: string; storageKey: string; status: string };
    };
    expect(body.voiceTrack.stationId).toBe('urban-radio');
    expect(body.voiceTrack.status).toBe('ready');
    expect(body.voiceTrack.storageKey).toMatch(
      /^stations\/urban-radio\/voice-tracks\/[^/]+\.mp3$/,
    );

    // R2 write happened
    expect(mockR2.putCalls).toHaveLength(1);
    expect(mockR2.putCalls[0].key).toMatch(
      /^stations\/urban-radio\/voice-tracks\/[^/]+\.mp3$/,
    );

    // D1 insert into voice_tracks happened with station_id from gate
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO voice_tracks/i.test(s.sql),
    );
    expect(insertStmt).toBeDefined();
    expect(insertStmt!.binds[1]).toBe('urban-radio');
    expect(insertStmt!.ran).toBe(true);

    // audit_log row written
    const auditStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO audit_log/i.test(s.sql),
    );
    expect(auditStmt).toBeDefined();
    expect(auditStmt!.binds).toContain('create');
    expect(auditStmt!.binds).toContain('voice_track');
  });

  test('given JSON-base64 mode > 201, R2 put + D1 insert', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb, mockR2 } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const audioBase64 = Buffer.from('ai-generated-audio-bytes').toString('base64');
    const res = await onRequestPost({
      env,
      request: buildRequest('/api/voice-tracks', {
        method: 'POST',
        body: JSON.stringify({
          audioBase64,
          durationMs: 5000,
          transcript: 'AI sweeper',
          aiGenerated: 1,
          status: 'ready',
        }),
        headers: { 'content-type': 'application/json' },
      }),
    });
    expect(res.status).toBe(201);
    expect(mockR2.putCalls).toHaveLength(1);
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO voice_tracks/i.test(s.sql),
    );
    expect(insertStmt).toBeDefined();
    // ai_generated is bind index 8 per the column order
    expect(insertStmt!.binds[8]).toBe(1);
  });

  test('cross-station station_id in body is ignored — server uses gate stationId', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
    });
    const req = buildMultipartRequest(new Blob(['fake']), {
      durationMs: 1000,
      stationId: 'other-station',
      station_id: 'other-station',
    });
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(201);
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO voice_tracks/i.test(s.sql),
    );
    expect(insertStmt!.binds).toContain('urban-radio');
    expect(insertStmt!.binds).not.toContain('other-station');
  });
});
