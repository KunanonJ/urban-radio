import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock the session module BEFORE importing the handler so requireStation
// sees the controlled session in this test scope.
vi.mock('../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequestPost } from './upload';
import { getSessionFromRequest } from '../_lib/session-jwt';
import type { SonicBloomEnv } from '../_lib/env';

// jsdom's File does not implement `stream()`. The upload handler calls
// `file.stream()` to pipe into R2; polyfill the method so we can exercise
// the full code path in a jsdom test environment.
// (Blob#arrayBuffer is supported; we wrap it in a ReadableStream.)
if (typeof File !== 'undefined' && typeof File.prototype.stream !== 'function') {
  Object.defineProperty(File.prototype, 'stream', {
    configurable: true,
    value: function stream(this: File) {
      const blob = this;
      return new ReadableStream({
        async start(controller) {
          const buf = await blob.arrayBuffer();
          controller.enqueue(new Uint8Array(buf));
          controller.close();
        },
      });
    },
  });
}

type AllResult = { results: unknown[]; success?: boolean };

interface PreparedStatement {
  sql: string;
  binds: unknown[];
  ran: boolean;
}

const buildD1 = (
  allResults: AllResult[],
  firstResults: (unknown | null)[] = [],
  insertThrows = false,
): {
  prepare: ReturnType<typeof vi.fn>;
  batch: ReturnType<typeof vi.fn>;
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
        if (insertThrows && /INSERT INTO radio_tracks/i.test(stmt.sql)) {
          return Promise.reject(new Error('simulated radio_tracks insert failure'));
        }
        stmt.ran = true;
        return Promise.resolve({ success: true, meta: {} });
      }),
    };
    return chain;
  });
  // batch() simulates the legacy INSERT INTO tracks + INSERT INTO media_objects.
  const batch = vi.fn(async () => {
    for (const stmt of preparedStatements) {
      if (
        /INSERT INTO tracks\b/i.test(stmt.sql) ||
        /INSERT INTO media_objects/i.test(stmt.sql)
      ) {
        stmt.ran = true;
      }
    }
    return [];
  });
  return { prepare, batch, preparedStatements };
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
  opts: {
    allResults?: AllResult[];
    firstResults?: (unknown | null)[];
    insertThrows?: boolean;
    withDb?: boolean;
    withR2?: boolean;
    secretSet?: boolean;
  } = {},
): {
  env: SonicBloomEnv;
  mockDb: ReturnType<typeof buildD1>;
  mockR2: ReturnType<typeof buildR2>;
} => {
  const {
    allResults = [],
    firstResults = [],
    insertThrows = false,
    withDb = true,
    withR2 = true,
    secretSet = true,
  } = opts;
  const mockDb = buildD1(allResults, firstResults, insertThrows);
  const mockR2 = buildR2();
  const env = {
    DB: withDb ? mockDb : undefined,
    MEDIA_BUCKET: withR2 ? { put: mockR2.put, delete: mockR2.del } : undefined,
    AUTH_JWT_SECRET: secretSet ? 'test-secret' : '',
  } as unknown as SonicBloomEnv;
  return { env, mockDb, mockR2 };
};

/**
 * Duck-typed Request object for multipart upload tests. We bypass the real
 * `Request.formData()` because jsdom's implementation hangs on multipart
 * bodies; we only need a working `headers`, `url`, and `formData()` for the
 * handler under test.
 */
const buildUploadRequest = (
  filename: string,
  mime: string,
  body: string,
  cookie: string | null = 'sb_session=valid-token',
): Request => {
  const fd = new FormData();
  fd.append('file', new File([body], filename, { type: mime }));
  const headers = new Headers({ 'content-type': 'multipart/form-data; boundary=xyz' });
  if (cookie) headers.set('cookie', cookie);
  return {
    headers,
    url: 'http://localhost/api/upload',
    method: 'POST',
    formData: async () => fd,
  } as unknown as Request;
};

const okSession = { sub: 'user-1', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/upload', () => {
  test('given no session > 401, no R2 write, no D1 insert', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env, mockDb, mockR2 } = buildEnv({
      allResults: [{ results: [], success: true }],
    });
    const req = buildUploadRequest('song.mp3', 'audio/mpeg', 'fake-audio-bytes');
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(401);
    expect(mockR2.putCalls).toHaveLength(0);
    // No D1 statements should be prepared on the rejected path.
    expect(mockDb.preparedStatements).toHaveLength(0);
  });

  test('given valid session > writes file to R2 under uploads/<id>/<safeName>', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    // Layout: [0] station_members lookup (in requireStation) → returns the row
    const { env, mockR2 } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
      firstResults: [null], // duplicate-check returns nothing
    });
    const req = buildUploadRequest('song.mp3', 'audio/mpeg', 'fake-audio-bytes');
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(200);
    expect(mockR2.putCalls).toHaveLength(1);
    expect(mockR2.putCalls[0].key).toMatch(/^uploads\/[^/]+\/song\.mp3$/);
  });

  test('given valid session > inserts radio_tracks row scoped to user station', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
      firstResults: [null],
    });
    const req = buildUploadRequest('song.mp3', 'audio/mpeg', 'fake-audio-bytes');
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(200);
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO radio_tracks/i.test(s.sql),
    );
    expect(insertStmt).toBeDefined();
    // station_id is the 2nd bind (per buildRadioTrackInsert column order: id, station_id, ...)
    expect(insertStmt!.binds[1]).toBe('urban-radio');
    expect(insertStmt!.ran).toBe(true);
  });

  test('given duplicate content_hash for same station > skips insert and returns deduped:true', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const existing = {
      id: 'existing-track-id',
      title: 'Existing Song',
      storage_key: 'uploads/old/song.mp3',
    };
    const { env, mockDb } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
      firstResults: [existing], // duplicate-check returns an existing track
    });
    const req = buildUploadRequest('song.mp3', 'audio/mpeg', 'fake-audio-bytes');
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deduped?: boolean; trackId?: string };
    expect(body.deduped).toBe(true);
    expect(body.trackId).toBe('existing-track-id');
    // No INSERT INTO radio_tracks should have been prepared.
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO radio_tracks/i.test(s.sql),
    );
    expect(insertStmt).toBeUndefined();
  });

  test('given filename containing "sweeper" > sets file_type=sweeper and category=cat-sweeper', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
      firstResults: [null],
    });
    const req = buildUploadRequest('sweeper-promo.mp3', 'audio/mpeg', 'fake-bytes');
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(200);
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO radio_tracks/i.test(s.sql),
    );
    expect(insertStmt).toBeDefined();
    // bind index 2 = category_id, bind index 7 = file_type (per buildRadioTrackInsert)
    expect(insertStmt!.binds[2]).toBe('cat-sweeper');
    expect(insertStmt!.binds[7]).toBe('sweeper');
  });

  test('given radio_tracks insert throws > still returns success (R2 + legacy write succeeded)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockR2 } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
      firstResults: [null],
      insertThrows: true,
    });
    const req = buildUploadRequest('song.mp3', 'audio/mpeg', 'fake-audio-bytes');
    const res = await onRequestPost({ env, request: req });
    // The legacy write and R2 put still succeeded — caller still got durable
    // storage of the audio asset. We do NOT 5xx for the radio_tracks rollout.
    expect(res.status).toBe(200);
    expect(mockR2.putCalls).toHaveLength(1);
  });

  test('given valid session > legacy tracks insert still happens (back-compat)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
      firstResults: [null],
    });
    const req = buildUploadRequest('song.mp3', 'audio/mpeg', 'fake-audio-bytes');
    await onRequestPost({ env, request: req });
    const legacyInsert = mockDb.preparedStatements.find((s) =>
      /INSERT INTO tracks\b/i.test(s.sql),
    );
    expect(legacyInsert).toBeDefined();
    const mediaInsert = mockDb.preparedStatements.find((s) =>
      /INSERT INTO media_objects/i.test(s.sql),
    );
    expect(mediaInsert).toBeDefined();
  });

  test('given valid session > computes and binds content_hash on radio_tracks row', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env, mockDb } = buildEnv({
      allResults: [{ results: [memberRow], success: true }],
      firstResults: [null],
    });
    const req = buildUploadRequest('song.mp3', 'audio/mpeg', 'fake-audio-bytes');
    await onRequestPost({ env, request: req });
    const insertStmt = mockDb.preparedStatements.find((s) =>
      /INSERT INTO radio_tracks/i.test(s.sql),
    );
    expect(insertStmt).toBeDefined();
    // bind index 5 is content_hash — must be a non-empty string (a hex hash)
    const hash = insertStmt!.binds[5];
    expect(typeof hash).toBe('string');
    expect((hash as string).length).toBeGreaterThan(8);
  });
});
