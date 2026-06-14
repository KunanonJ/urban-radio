// @vitest-environment node
// Route handlers use `jose` (HS256); see routes-beta1.test.ts for context.

/**
 * Wave RM-β5 — voice-tracks + comments + presence Next.js Route Handlers.
 *
 * Drives each handler through a pg-mem-backed Drizzle client. The goal is to
 * pin the request → response contract so the Cloudflare and Railway stacks
 * stay observationally identical during the dual-stack window.
 *
 * Test layout:
 *   - Voice tracks: list, get, create, patch, delete + auth + edge cases.
 *   - Comments: list, create, patch (author + role gating), delete + cross-
 *     station 404, resolve/unresolve.
 *   - Presence: list filtered by TTL window, heartbeat upsert path verified
 *     against the UNIQUE conflict target.
 */

import { describe, expect, test } from 'vitest';

import {
  createVoiceTrackHandler,
  listVoiceTracksHandler,
} from '@/app/api/voice-tracks/route-impl';
import { MAX_UPLOAD_BYTES, MAX_VOICE_TRACK_BASE64_CHARS } from '@/server/upload-helpers';
import {
  deleteVoiceTrackHandler,
  getVoiceTrackHandler,
  patchVoiceTrackHandler,
} from '@/app/api/voice-tracks/[id]/route-impl';
import {
  createCommentHandler,
  listCommentsHandler,
} from '@/app/api/comments/route-impl';
import {
  deleteCommentHandler,
  patchCommentHandler,
} from '@/app/api/comments/[id]/route-impl';
import { listPresenceHandler } from '@/app/api/presence/route-impl';
import { heartbeatHandler } from '@/app/api/presence/heartbeat/route-impl';

import { signSessionToken } from '@/server/auth/session-jwt';
import {
  createTestDbWithUser,
  seedAuthFixture,
  type TestDbHandle,
} from '@/server/test-utils/db';

const SECRET = 'beta5-test-secret';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function authedRequest(
  userId: string,
  username: string,
  url: string,
  init: RequestInit = {},
): Promise<Request> {
  const token = await signSessionToken(SECRET, { sub: userId, username });
  const headers = new Headers(init.headers);
  headers.set('Cookie', `sb_session=${encodeURIComponent(token)}`);
  return new Request(url, { ...init, headers });
}

function bareRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

const SEED_NOW = '2026-01-01T00:00:00Z';

/**
 * Helper to insert a secondary auth_user row. The Drizzle Postgres mirror
 * uses `text` columns with a `now() at time zone 'utc'` default that pg-mem
 * strips — so we must bind `created_at` explicitly to avoid NOT NULL errors.
 */
function seedExtraUser(
  handle: TestDbHandle,
  userId: string,
  username: string,
  stationId: string,
  role: 'operator' | 'producer' | 'programmer' | 'admin' | 'guest_vt',
): void {
  handle.mem.public.none(
    `INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('${userId}', '${username}', 'pbkdf2:1:00:00', '${SEED_NOW}')`,
  );
  handle.mem.public.none(
    `INSERT INTO station_members (station_id, user_id, role, created_at) VALUES ('${stationId}', '${userId}', '${role}', '${SEED_NOW}')`,
  );
}

function seedExtraStation(
  handle: TestDbHandle,
  orgId: string,
  stationId: string,
): void {
  handle.mem.public.none(
    `INSERT INTO organizations (id, name, plan, created_at) VALUES ('${orgId}', 'Other', 'free', '${SEED_NOW}')`,
  );
  handle.mem.public.none(
    `INSERT INTO stations (id, org_id, slug, name, timezone, created_at) VALUES ('${stationId}', '${orgId}', 'other', 'Other', 'UTC', '${SEED_NOW}')`,
  );
}

interface SeededVoiceTrack {
  id: string;
  createdAt: string;
}

function seedVoiceTrack(
  handle: TestDbHandle,
  stationId: string,
  userId: string,
  overrides: Partial<{
    id: string;
    status: string;
    createdAt: string;
    targetClockSlotId: string | null;
    aiGenerated: number;
  }> = {},
): SeededVoiceTrack {
  const id = overrides.id ?? `vt-${Math.random().toString(36).slice(2, 8)}`;
  const status = overrides.status ?? 'draft';
  const createdAt = overrides.createdAt ?? '2026-05-01T10:00:00Z';
  const slot = overrides.targetClockSlotId ?? null;
  const ai = overrides.aiGenerated ?? 0;
  handle.mem.public.none(
    `INSERT INTO voice_tracks (id, station_id, recorded_by, storage_key, duration_ms, transcript, target_clock_slot_id, status, ai_generated, created_at)
     VALUES ('${id}', '${stationId}', '${userId}', 'stations/${stationId}/voice-tracks/${id}.mp3', 1500, 'hello', ${slot ? `'${slot}'` : 'NULL'}, '${status}', ${ai}, '${createdAt}')`,
  );
  return { id, createdAt };
}

interface SeededComment {
  id: string;
  createdAt: string;
}

function seedComment(
  handle: TestDbHandle,
  stationId: string,
  authorUserId: string,
  overrides: Partial<{
    id: string;
    targetType: string;
    targetId: string;
    body: string;
    resolvedAt: string | null;
    createdAt: string;
  }> = {},
): SeededComment {
  const id = overrides.id ?? `c-${Math.random().toString(36).slice(2, 8)}`;
  const targetType = overrides.targetType ?? 'voice_track';
  const targetId = overrides.targetId ?? 'vt-x';
  const body = overrides.body ?? 'looks good';
  const resolvedAt =
    overrides.resolvedAt === undefined ? null : overrides.resolvedAt;
  const createdAt = overrides.createdAt ?? '2026-05-01T10:00:00Z';
  handle.mem.public.none(
    `INSERT INTO comments (id, station_id, author_user_id, target_type, target_id, body, resolved_at, resolved_by_user_id, created_at, updated_at)
     VALUES ('${id}', '${stationId}', '${authorUserId}', '${targetType}', '${targetId}', '${body.replace(/'/g, "''")}', ${resolvedAt ? `'${resolvedAt}'` : 'NULL'}, NULL, '${createdAt}', '${createdAt}')`,
  );
  return { id, createdAt };
}

function seedPresence(
  handle: TestDbHandle,
  stationId: string,
  userId: string,
  overrides: Partial<{
    id: string;
    targetType: string;
    targetId: string;
    lastHeartbeatAt: string;
    createdAt: string;
  }> = {},
): void {
  const id = overrides.id ?? `p-${Math.random().toString(36).slice(2, 8)}`;
  const targetType = overrides.targetType ?? 'voice_track';
  const targetId = overrides.targetId ?? 'vt-1';
  const hb = overrides.lastHeartbeatAt ?? '2026-05-14T10:00:00Z';
  const created = overrides.createdAt ?? hb;
  handle.mem.public.none(
    `INSERT INTO presence_sessions (id, station_id, user_id, target_type, target_id, last_heartbeat_at, created_at)
     VALUES ('${id}', '${stationId}', '${userId}', '${targetType}', '${targetId}', '${hb}', '${created}')`,
  );
}

// ---------------------------------------------------------------------------
// /api/voice-tracks (GET)
// ---------------------------------------------------------------------------

describe('GET /api/voice-tracks', () => {
  test('401 when there is no session cookie', async () => {
    const { handle } = createTestDbWithUser();
    const res = await listVoiceTracksHandler(
      bareRequest('http://localhost/api/voice-tracks'),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('200 with empty list on a fresh schema', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks',
    );
    const res = await listVoiceTracksHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      voiceTracks: unknown[];
      meta: { nextCursor: string | null; limit: number };
    };
    expect(body.voiceTracks).toEqual([]);
    expect(body.meta.nextCursor).toBeNull();
    expect(body.meta.limit).toBe(50);
  });

  test('returns rows in created_at DESC order and filters by status', async () => {
    const { handle, user } = createTestDbWithUser();
    seedVoiceTrack(handle, user.stationId, user.userId, {
      id: 'vt-old',
      createdAt: '2026-05-01T08:00:00Z',
      status: 'aired',
    });
    seedVoiceTrack(handle, user.stationId, user.userId, {
      id: 'vt-new',
      createdAt: '2026-05-02T09:00:00Z',
      status: 'draft',
    });

    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks?status=draft',
    );
    const res = await listVoiceTracksHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { voiceTracks: Array<{ id: string }> };
    expect(body.voiceTracks).toHaveLength(1);
    expect(body.voiceTracks[0].id).toBe('vt-new');
  });

  test('400 when status query param is not in VT_STATUSES', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks?status=lunch',
    );
    const res = await listVoiceTracksHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// /api/voice-tracks (POST)
// ---------------------------------------------------------------------------

describe('POST /api/voice-tracks', () => {
  test('401 when unauthenticated', async () => {
    const { handle } = createTestDbWithUser();
    const res = await createVoiceTrackHandler(
      bareRequest('http://localhost/api/voice-tracks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ durationMs: 1000, audioBase64: 'aGVsbG8=' }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('201 creates row and writes audit log via JSON-base64 mode', async () => {
    const { handle, user } = createTestDbWithUser();
    // Use valid ID3 magic bytes (49 44 33) so the H-04 magic-byte sniff passes.
    const mp3WithId3 = new Uint8Array([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00]);
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          durationMs: 4321,
          transcript: 'hi mom',
          audioBase64: Buffer.from(mp3WithId3).toString('base64'),
          status: 'ready',
          aiGenerated: true,
        }),
      },
    );
    const res = await createVoiceTrackHandler(req, {
      db: handle.db,
      secret: SECRET,
      idGenerator: () => 'vt-fixed-id',
      now: () => '2026-05-10T00:00:00Z',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      voiceTrack: {
        id: string;
        status: string;
        recordedBy: string;
        storageKey?: string;
        aiGenerated: number;
        durationMs: number;
        transcript: string | null;
      };
    };
    expect(body.voiceTrack.id).toBe('vt-fixed-id');
    expect(body.voiceTrack.status).toBe('ready');
    expect(body.voiceTrack.aiGenerated).toBe(1);
    expect(body.voiceTrack.durationMs).toBe(4321);
    expect(body.voiceTrack.transcript).toBe('hi mom');
    expect(body.voiceTrack.recordedBy).toBe(user.userId);
    // Pentest M-08: storage key MUST NOT be exposed in the JSON response.
    expect(body.voiceTrack.storageKey).toBeUndefined();
    // The key still lands in storage — verify there instead.
    const storedRows = handle.mem.public.many(
      "SELECT storage_key FROM voice_tracks WHERE id = 'vt-fixed-id'",
    ) as Array<{ storage_key: string }>;
    expect(storedRows[0].storage_key).toBe(
      `stations/${user.stationId}/voice-tracks/vt-fixed-id.mp3`,
    );

    const rows = handle.mem.public.many(
      "SELECT id, target_type, action FROM audit_log WHERE target_id = 'vt-fixed-id'",
    ) as Array<{ target_type: string; action: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].target_type).toBe('voice_track');
    expect(rows[0].action).toBe('create');
  });

  test('400 when audio meta validation fails (durationMs negative)', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ durationMs: -5, audioBase64: 'aGVsbG8=' }),
      },
    );
    const res = await createVoiceTrackHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  // -------------------------------------------------------------------------
  // H-03: Base64 size cap test
  // -------------------------------------------------------------------------

  test('413 (via 400 Zod) when audioBase64 exceeds MAX_VOICE_TRACK_BASE64_CHARS', async () => {
    const { handle, user } = createTestDbWithUser();
    // Build a base64 string just over the cap. The string itself is just
    // 'A' repeated — Zod's .max() rejects before any decode attempt.
    const oversizedBase64 = 'A'.repeat(MAX_VOICE_TRACK_BASE64_CHARS + 1);
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ durationMs: 1000, audioBase64: oversizedBase64 }),
      },
    );
    const res = await createVoiceTrackHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    // Zod .max() violation ⇒ 400 Validation failed (the cap is enforced at schema level)
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Validation failed');
  });

  // -------------------------------------------------------------------------
  // H-04: MIME allowlist and magic-byte tests for voice-tracks
  // -------------------------------------------------------------------------

  test('415 when multipart voice-track has disallowed MIME type', async () => {
    const { handle, user } = createTestDbWithUser();
    // Build a multipart request with text/html MIME type.
    const fd = new FormData();
    const htmlBytes = new TextEncoder().encode('<html>not audio</html>');
    fd.append('file', new File([htmlBytes], 'evil.html', { type: 'text/html' }));
    fd.append('meta', JSON.stringify({ durationMs: 1000 }));

    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks',
      {
        method: 'POST',
        body: fd,
      },
    );
    const res = await createVoiceTrackHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string; contentType: string };
    expect(body.error).toBe('Audio MIME type not allowed');
    expect(body.contentType).toBe('text/html');
  });

  test('415 when JSON-base64 voice-track decoded bytes fail magic-byte sniff', async () => {
    const { handle, user } = createTestDbWithUser();
    // Encode HTML as base64 — passes Zod string check but magic bytes are not audio.
    const htmlBase64 = Buffer.from('<html>not audio</html>').toString('base64');
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ durationMs: 1000, audioBase64: htmlBase64 }),
      },
    );
    const res = await createVoiceTrackHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('File content is not a recognized audio format');
  });

  test('201 with valid MP3 magic bytes via JSON-base64 (regression check)', async () => {
    const { handle, user } = createTestDbWithUser();
    // Build valid MP3-magic bytes (ID3 header) and encode as base64.
    const mp3Bytes = new Uint8Array(16);
    mp3Bytes[0] = 0x49; // I
    mp3Bytes[1] = 0x44; // D
    mp3Bytes[2] = 0x33; // 3
    const mp3Base64 = Buffer.from(mp3Bytes).toString('base64');

    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ durationMs: 500, audioBase64: mp3Base64 }),
      },
    );
    const res = await createVoiceTrackHandler(req, {
      db: handle.db,
      secret: SECRET,
      idGenerator: () => 'vt-mp3-ok',
      now: () => '2026-05-16T00:00:00Z',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { voiceTrack: { id: string } };
    expect(body.voiceTrack.id).toBe('vt-mp3-ok');
  });

  test('413 (via 400) when voice-track multipart Content-Length exceeds MAX_UPLOAD_BYTES', async () => {
    const { handle, user } = createTestDbWithUser();
    // Declare a content-type that includes multipart so the check fires before body read.
    const token = await import('@/server/auth/session-jwt').then((m) =>
      m.signSessionToken(SECRET, { sub: user.userId, username: user.username }),
    );
    const fd = new FormData();
    const mp3Bytes = new Uint8Array(4);
    mp3Bytes[0] = 0x49; mp3Bytes[1] = 0x44; mp3Bytes[2] = 0x33; mp3Bytes[3] = 0x00;
    fd.append('file', new File([mp3Bytes], 'a.mp3', { type: 'audio/mpeg' }));
    fd.append('meta', JSON.stringify({ durationMs: 100 }));

    const res = await createVoiceTrackHandler(
      new Request('http://localhost/api/voice-tracks', {
        method: 'POST',
        headers: {
          Cookie: `sb_session=${encodeURIComponent(token)}`,
          'Content-Length': String(MAX_UPLOAD_BYTES + 1),
        },
        body: fd,
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; maxBytes: number };
    expect(body.error).toBe('Upload too large');
    expect(body.maxBytes).toBe(MAX_UPLOAD_BYTES);
  });
});

// ---------------------------------------------------------------------------
// /api/voice-tracks/:id (GET / PATCH / DELETE)
// ---------------------------------------------------------------------------

describe('/api/voice-tracks/:id', () => {
  test('GET 404 when row does not exist', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks/missing',
    );
    const res = await getVoiceTrackHandler(req, 'missing', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });

  test('GET returns the row with streamUrl', async () => {
    const { handle, user } = createTestDbWithUser();
    const seed = seedVoiceTrack(handle, user.stationId, user.userId, {
      id: 'vt-r',
    });
    const req = await authedRequest(
      user.userId,
      user.username,
      `http://localhost/api/voice-tracks/${seed.id}`,
    );
    const res = await getVoiceTrackHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      voiceTrack: { id: string; streamUrl: string };
    };
    expect(body.voiceTrack.id).toBe(seed.id);
    expect(body.voiceTrack.streamUrl).toBe(`/api/voice-tracks/${seed.id}/stream`);
  });

  test('PATCH updates fields and writes update audit row', async () => {
    const { handle, user } = createTestDbWithUser();
    const seed = seedVoiceTrack(handle, user.stationId, user.userId, {
      id: 'vt-p',
    });
    const req = await authedRequest(
      user.userId,
      user.username,
      `http://localhost/api/voice-tracks/${seed.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'ready', transcript: 'updated' }),
      },
    );
    const res = await patchVoiceTrackHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      voiceTrack: { status: string; transcript: string };
    };
    expect(body.voiceTrack.status).toBe('ready');
    expect(body.voiceTrack.transcript).toBe('updated');

    const rows = handle.mem.public.many(
      `SELECT action FROM audit_log WHERE target_id = '${seed.id}' AND target_type = 'voice_track'`,
    ) as Array<{ action: string }>;
    expect(rows.map((r) => r.action)).toContain('update');
  });

  test('PATCH 400 when nothing to update', async () => {
    const { handle, user } = createTestDbWithUser();
    const seed = seedVoiceTrack(handle, user.stationId, user.userId);
    const req = await authedRequest(
      user.userId,
      user.username,
      `http://localhost/api/voice-tracks/${seed.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    const res = await patchVoiceTrackHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('DELETE 404 for cross-station id', async () => {
    const { handle, user } = createTestDbWithUser();
    // Seed a row that belongs to a second, foreign station — the row exists
    // but is invisible to the caller.
    seedExtraStation(handle, 'org-other', 'station-other');
    seedVoiceTrack(handle, 'station-other', user.userId, { id: 'vt-other' });

    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/voice-tracks/vt-other',
      { method: 'DELETE' },
    );
    const res = await deleteVoiceTrackHandler(req, 'vt-other', {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(404);
  });

  test('DELETE deletes the DB row first, then the storage object (L-01 ordering)', async () => {
    const { handle, user } = createTestDbWithUser();
    const seed = seedVoiceTrack(handle, user.stationId, user.userId, {
      id: 'vt-order',
    });

    // The bucket records whether the DB row was still present at the moment
    // its delete() was invoked. With the L-01 fix the DB row must already be
    // gone (DB-first ordering); with the old R2-first ordering it would still
    // be present.
    let rowPresentWhenStorageDeleted: boolean | null = null;
    const bucket = {
      put: async () => {
        throw new Error('not used in this test');
      },
      delete: async (_key: string) => {
        const rows = handle.mem.public.many(
          `SELECT id FROM voice_tracks WHERE id = '${seed.id}'`,
        ) as Array<{ id: string }>;
        rowPresentWhenStorageDeleted = rows.length > 0;
      },
    };

    const req = await authedRequest(
      user.userId,
      user.username,
      `http://localhost/api/voice-tracks/${seed.id}`,
      { method: 'DELETE' },
    );
    const res = await deleteVoiceTrackHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
      bucket,
    });
    expect(res.status).toBe(200);
    // Storage delete ran, and at that point the DB row was already deleted.
    expect(rowPresentWhenStorageDeleted).toBe(false);
  });

  test('DELETE returns success and removes the DB row even when storage delete throws (L-01 no dangling row)', async () => {
    const { handle, user } = createTestDbWithUser();
    const seed = seedVoiceTrack(handle, user.stationId, user.userId, {
      id: 'vt-storage-fail',
    });

    const bucket = {
      put: async () => {
        throw new Error('not used in this test');
      },
      delete: async (_key: string) => {
        throw new Error('simulated R2 delete failure');
      },
    };

    const req = await authedRequest(
      user.userId,
      user.username,
      `http://localhost/api/voice-tracks/${seed.id}`,
      { method: 'DELETE' },
    );
    const res = await deleteVoiceTrackHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
      bucket,
    });

    // A storage failure must NOT surface as a 500 and must NOT leave a
    // dangling DB row pointing at bytes that may or may not still exist.
    expect(res.status).toBe(200);
    const remaining = handle.mem.public.many(
      `SELECT id FROM voice_tracks WHERE id = '${seed.id}'`,
    ) as Array<{ id: string }>;
    expect(remaining).toHaveLength(0);

    // The audit row is still written.
    const audit = handle.mem.public.many(
      `SELECT action FROM audit_log WHERE target_id = '${seed.id}' AND target_type = 'voice_track'`,
    ) as Array<{ action: string }>;
    expect(audit.map((r) => r.action)).toContain('delete');
  });

  test('DELETE removes row + writes delete audit row + invokes bucket adapter', async () => {
    const { handle, user } = createTestDbWithUser();
    const seed = seedVoiceTrack(handle, user.stationId, user.userId, {
      id: 'vt-d',
    });
    const deleted: string[] = [];
    const bucket = {
      put: async () => {
        throw new Error('not used in this test');
      },
      delete: async (key: string) => {
        deleted.push(key);
      },
    };
    const req = await authedRequest(
      user.userId,
      user.username,
      `http://localhost/api/voice-tracks/${seed.id}`,
      { method: 'DELETE' },
    );
    const res = await deleteVoiceTrackHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
      bucket,
    });
    expect(res.status).toBe(200);

    const remaining = handle.mem.public.many(
      `SELECT id FROM voice_tracks WHERE id = '${seed.id}'`,
    ) as Array<{ id: string }>;
    expect(remaining).toHaveLength(0);

    expect(deleted).toEqual([
      `stations/${user.stationId}/voice-tracks/${seed.id}.mp3`,
    ]);
  });
});

// ---------------------------------------------------------------------------
// /api/comments (GET + POST)
// ---------------------------------------------------------------------------

describe('GET /api/comments', () => {
  test('401 when unauthenticated', async () => {
    const { handle } = createTestDbWithUser();
    const res = await listCommentsHandler(
      bareRequest(
        'http://localhost/api/comments?targetType=voice_track&targetId=vt-1',
      ),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('400 when targetType is missing', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/comments?targetId=x',
    );
    const res = await listCommentsHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('lists unresolved comments only by default and includes author.username', async () => {
    const { handle, user } = createTestDbWithUser();
    seedComment(handle, user.stationId, user.userId, {
      id: 'c-open',
      targetType: 'voice_track',
      targetId: 'vt-1',
      createdAt: '2026-05-01T10:00:00Z',
    });
    seedComment(handle, user.stationId, user.userId, {
      id: 'c-resolved',
      targetType: 'voice_track',
      targetId: 'vt-1',
      resolvedAt: '2026-05-01T11:00:00Z',
      createdAt: '2026-05-01T11:00:00Z',
    });

    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/comments?targetType=voice_track&targetId=vt-1',
    );
    const res = await listCommentsHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      comments: Array<{
        id: string;
        author: { username: string | null };
      }>;
    };
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].id).toBe('c-open');
    expect(body.comments[0].author.username).toBe(user.username);
  });

  test('includeResolved=true surfaces resolved rows too', async () => {
    const { handle, user } = createTestDbWithUser();
    seedComment(handle, user.stationId, user.userId, {
      id: 'c-1',
      targetType: 'voice_track',
      targetId: 'vt-1',
      createdAt: '2026-05-01T10:00:00Z',
    });
    seedComment(handle, user.stationId, user.userId, {
      id: 'c-2',
      targetType: 'voice_track',
      targetId: 'vt-1',
      resolvedAt: '2026-05-01T11:00:00Z',
      createdAt: '2026-05-01T11:00:00Z',
    });
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/comments?targetType=voice_track&targetId=vt-1&includeResolved=true',
    );
    const res = await listCommentsHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { comments: Array<{ id: string }> };
    expect(body.comments).toHaveLength(2);
  });
});

describe('POST /api/comments', () => {
  test('401 when unauthenticated', async () => {
    const { handle } = createTestDbWithUser();
    const res = await createCommentHandler(
      bareRequest('http://localhost/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: 'voice_track',
          targetId: 'vt-1',
          body: 'hello',
        }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('201 inserts row + audit and includes author info', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/comments',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: 'voice_track',
          targetId: 'vt-1',
          body: '  thumbs up  ',
        }),
      },
    );
    const res = await createCommentHandler(req, {
      db: handle.db,
      secret: SECRET,
      idGenerator: () => 'c-new',
      now: () => '2026-05-12T00:00:00Z',
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      comment: {
        id: string;
        body: string;
        author: { userId: string; username: string | null };
        targetType: string;
        targetId: string;
        createdAt: string;
        updatedAt: string;
      };
    };
    expect(body.comment.id).toBe('c-new');
    // Body is trimmed in the response.
    expect(body.comment.body).toBe('thumbs up');
    expect(body.comment.author.userId).toBe(user.userId);
    expect(body.comment.author.username).toBe(user.username);
    expect(body.comment.createdAt).toBe('2026-05-12T00:00:00Z');

    const audit = handle.mem.public.many(
      "SELECT target_type, action FROM audit_log WHERE target_id = 'c-new'",
    ) as Array<{ target_type: string; action: string }>;
    expect(audit).toEqual([{ target_type: 'comment', action: 'create' }]);
  });

  test('400 when body is blank after trim', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/comments',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetType: 'voice_track',
          targetId: 'vt-1',
          body: '   ',
        }),
      },
    );
    const res = await createCommentHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    // Zod's min(1) already rejects an empty string, but the body would still
    // be non-empty pre-trim. Either Zod or our own trim check should kick.
    // Both yield 400.
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// /api/comments/:id (PATCH + DELETE)
// ---------------------------------------------------------------------------

describe('/api/comments/:id PATCH', () => {
  test('403 when a non-author tries to edit body', async () => {
    const { handle, user } = createTestDbWithUser({
      userId: 'u-author',
      username: 'author',
    });
    // Seed a second member of the same station so we can authenticate "them".
    seedExtraUser(handle, 'u-other', 'other', user.stationId, 'operator');
    const seed = seedComment(handle, user.stationId, 'u-author', {
      id: 'c-edit',
    });

    const req = await authedRequest(
      'u-other',
      'other',
      `http://localhost/api/comments/${seed.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'malicious edit' }),
      },
    );
    const res = await patchCommentHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('producer can resolve a comment they did not author', async () => {
    const { handle, user } = createTestDbWithUser({
      userId: 'u-author',
      username: 'author',
    });
    seedExtraUser(handle, 'u-prod', 'prod', user.stationId, 'producer');
    const seed = seedComment(handle, user.stationId, 'u-author', {
      id: 'c-resolveme',
    });

    const req = await authedRequest(
      'u-prod',
      'prod',
      `http://localhost/api/comments/${seed.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolved: true }),
      },
    );
    const res = await patchCommentHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
      now: () => '2026-05-13T00:00:00Z',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      comment: { resolvedAt: string | null; resolvedByUserId: string | null };
    };
    expect(body.comment.resolvedAt).toBe('2026-05-13T00:00:00Z');
    expect(body.comment.resolvedByUserId).toBe('u-prod');
  });

  test('author can edit own body', async () => {
    const { handle, user } = createTestDbWithUser();
    const seed = seedComment(handle, user.stationId, user.userId, {
      id: 'c-mine',
    });
    const req = await authedRequest(
      user.userId,
      user.username,
      `http://localhost/api/comments/${seed.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: 'edited' }),
      },
    );
    const res = await patchCommentHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { comment: { body: string } };
    expect(body.comment.body).toBe('edited');
  });
});

describe('/api/comments/:id DELETE', () => {
  test('admin can delete a comment authored by someone else', async () => {
    const { handle, user } = createTestDbWithUser({
      userId: 'u-admin',
      username: 'admin',
      role: 'admin',
    });
    seedExtraUser(handle, 'u-author', 'author', user.stationId, 'operator');
    const seed = seedComment(handle, user.stationId, 'u-author', {
      id: 'c-del',
    });

    const req = await authedRequest(
      user.userId,
      user.username,
      `http://localhost/api/comments/${seed.id}`,
      { method: 'DELETE' },
    );
    const res = await deleteCommentHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const remaining = handle.mem.public.many(
      `SELECT id FROM comments WHERE id = '${seed.id}'`,
    ) as Array<{ id: string }>;
    expect(remaining).toHaveLength(0);
  });

  test('operator (non-author) cannot delete somebody else\'s comment', async () => {
    const { handle, user } = createTestDbWithUser({
      userId: 'u-author',
      username: 'author',
      role: 'admin',
    });
    seedExtraUser(handle, 'u-op', 'op', user.stationId, 'operator');
    const seed = seedComment(handle, user.stationId, user.userId, {
      id: 'c-locked',
    });
    const req = await authedRequest(
      'u-op',
      'op',
      `http://localhost/api/comments/${seed.id}`,
      { method: 'DELETE' },
    );
    const res = await deleteCommentHandler(req, seed.id, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// /api/presence (GET)
// ---------------------------------------------------------------------------

describe('GET /api/presence', () => {
  test('401 when unauthenticated', async () => {
    const { handle } = createTestDbWithUser();
    const res = await listPresenceHandler(
      bareRequest(
        'http://localhost/api/presence?targetType=voice_track&targetId=vt-1',
      ),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('400 when targetType is missing', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/presence?targetId=vt-1',
    );
    const res = await listPresenceHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('returns only sessions inside the 15s TTL window', async () => {
    const { handle, user } = createTestDbWithUser();
    seedExtraUser(handle, 'u-stale', 'stale-user', user.stationId, 'operator');

    seedPresence(handle, user.stationId, user.userId, {
      id: 'p-fresh',
      targetType: 'voice_track',
      targetId: 'vt-1',
      lastHeartbeatAt: '2026-05-14T10:00:10Z',
    });
    // Stale row: heartbeat older than 15s before `now`. Uses a distinct user
    // because the unique index on (station, user, target_type, target_id)
    // prevents two rows for the same caller on the same target.
    seedPresence(handle, user.stationId, 'u-stale', {
      id: 'p-stale',
      targetType: 'voice_track',
      targetId: 'vt-1',
      lastHeartbeatAt: '2026-05-14T09:00:00Z',
    });

    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/presence?targetType=voice_track&targetId=vt-1',
    );
    const res = await listPresenceHandler(req, {
      db: handle.db,
      secret: SECRET,
      now: () => '2026-05-14T10:00:15Z',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{ id: string }>;
      meta: { ttlSeconds: number };
    };
    expect(body.sessions.map((s) => s.id)).toEqual(['p-fresh']);
    expect(body.meta.ttlSeconds).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// /api/presence/heartbeat (POST)
// ---------------------------------------------------------------------------

describe('POST /api/presence/heartbeat', () => {
  test('401 when unauthenticated', async () => {
    const { handle } = createTestDbWithUser();
    const res = await heartbeatHandler(
      bareRequest('http://localhost/api/presence/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType: 'voice_track', targetId: 'vt-1' }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('400 when targetType is invalid', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/presence/heartbeat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType: 'bogus', targetId: 'x' }),
      },
    );
    const res = await heartbeatHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('first heartbeat inserts row + returns the active session list', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/presence/heartbeat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType: 'voice_track', targetId: 'vt-7' }),
      },
    );
    const res = await heartbeatHandler(req, {
      db: handle.db,
      secret: SECRET,
      idGenerator: () => 'p-fresh',
      now: () => '2026-05-14T10:00:00Z',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      sessions: Array<{ id: string; userId: string; username: string | null }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0].id).toBe('p-fresh');
    expect(body.sessions[0].userId).toBe(user.userId);
    expect(body.sessions[0].username).toBe(user.username);
  });

  test('second heartbeat upserts the same row (ON CONFLICT path)', async () => {
    const { handle, user } = createTestDbWithUser();
    const targetId = 'vt-9';
    // First beat.
    const req1 = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/presence/heartbeat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType: 'voice_track', targetId }),
      },
    );
    await heartbeatHandler(req1, {
      db: handle.db,
      secret: SECRET,
      idGenerator: () => 'p-original',
      now: () => '2026-05-14T10:00:00Z',
    });

    // Second beat with a NEW id but the same target tuple — must upsert.
    const req2 = await authedRequest(
      user.userId,
      user.username,
      'http://localhost/api/presence/heartbeat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetType: 'voice_track', targetId }),
      },
    );
    const res2 = await heartbeatHandler(req2, {
      db: handle.db,
      secret: SECRET,
      idGenerator: () => 'p-conflicting',
      now: () => '2026-05-14T10:00:05Z',
    });
    expect(res2.status).toBe(200);

    const rows = handle.mem.public.many(
      `SELECT id, last_heartbeat_at FROM presence_sessions WHERE station_id = '${user.stationId}' AND user_id = '${user.userId}' AND target_type = 'voice_track' AND target_id = '${targetId}'`,
    ) as Array<{ id: string; last_heartbeat_at: string }>;
    expect(rows).toHaveLength(1);
    // Original id is preserved across the upsert.
    expect(rows[0].id).toBe('p-original');
    expect(rows[0].last_heartbeat_at).toBe('2026-05-14T10:00:05Z');
  });
});

// ---------------------------------------------------------------------------
// Cross-cutting: 403 when authenticated but no station_members row.
// ---------------------------------------------------------------------------

describe('cross-cutting auth', () => {
  test('voice-tracks list returns 403 when the caller has no station membership', async () => {
    const { handle } = createTestDbWithUser();
    // Seed an orphan user (no station_members row) so the gate falls through
    // to the "no station" branch.
    handle.mem.public.none(
      `INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('u-orphan', 'orphan', 'pbkdf2:1:00:00', '${SEED_NOW}')`,
    );
    const req = await authedRequest(
      'u-orphan',
      'orphan',
      'http://localhost/api/voice-tracks',
    );
    const res = await listVoiceTracksHandler(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });
});

// Reference symbols so the imports don't get tree-shaken into oblivion.
void seedAuthFixture;
