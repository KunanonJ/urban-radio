// @vitest-environment node
// Route handlers use `jose` (HS256); see require-station.test.ts for context.

/**
 * Wave RM-β3 — Stream + Upload Next.js Route Handlers.
 *
 * Each test exercises the named handler against a pg-mem-backed Drizzle
 * client plus the in-memory `StorageAdapter` stub. The goal is the same
 * as β1: lock down the input → output contract so Railway and Cloudflare
 * stay observationally identical during the dual-stack window.
 *
 * Stream control state is process-local in the stub; we reset it between
 * tests via `__resetStubStreamControlForTests()`.
 */

import { beforeEach, describe, expect, test } from 'vitest';

import { getStreamStatusRoute } from '@/app/api/stream/status/route-impl';
import { postStreamStart } from '@/app/api/stream/start/route-impl';
import { postStreamStop } from '@/app/api/stream/stop/route-impl';
import { postStreamMetadata } from '@/app/api/stream/metadata/route-impl';
import { getTrackStream } from '@/app/api/tracks/[id]/stream/route-impl';
import { postUpload } from '@/app/api/upload/route-impl';
import {
  signSessionToken,
  sessionCookieName,
} from '@/server/auth/session-jwt';
import {
  __resetStubStreamControlForTests,
  type StreamControlAdapter,
  type StreamMetadata,
  type StreamStatus,
} from '@/server/stream-control';
import { createInMemoryStorage } from '@/server/storage';
import {
  createTestDb,
  createTestDbWithUser,
  type TestDbHandle,
  type SeededUser,
} from '@/server/test-utils/db';
import { MAX_UPLOAD_BYTES } from '@/server/upload-helpers';

const SECRET = 'beta3-test-secret';

beforeEach(() => {
  __resetStubStreamControlForTests();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildAuthedRequest(
  userId: string,
  username: string,
  init: {
    url?: string;
    method?: string;
    body?: BodyInit | null;
    contentType?: string;
  } = {},
): Promise<Request> {
  const token = await signSessionToken(SECRET, { sub: userId, username });
  const headers = new Headers({
    Cookie: `${sessionCookieName()}=${encodeURIComponent(token)}`,
  });
  if (init.contentType) headers.set('Content-Type', init.contentType);
  return new Request(init.url ?? 'http://localhost/api/route', {
    method: init.method ?? 'GET',
    headers,
    body: init.body ?? null,
  });
}

interface SeededCtx {
  handle: TestDbHandle;
  user: SeededUser;
}

function seed(opts: Parameters<typeof createTestDbWithUser>[0] = {}): SeededCtx {
  const { handle, user } = createTestDbWithUser(opts);
  return { handle, user };
}

/**
 * Seed the five default categories so `radio_tracks.category_id` FKs resolve.
 * Matches the D1 migration 0005 seed.
 */
function seedDefaultCategories(handle: TestDbHandle, stationId: string): void {
  const cats = [
    ['cat-music', 'Music', '#3b82f6', 90],
    ['cat-jingle', 'Jingle', '#f97316', 0],
    ['cat-sweeper', 'Sweeper', '#a855f7', 0],
    ['cat-id', 'Station ID', '#10b981', 0],
    ['cat-spot', 'Spot', '#ef4444', 30],
  ] as const;
  for (const [id, name, color, rpm] of cats) {
    handle.mem.public.none(
      `INSERT INTO categories (id, station_id, name, color, repeat_protection_minutes, level_db, suppress_title, created_at)
         VALUES ('${id}', '${stationId}', '${name}', '${color}', ${rpm}, 0, 0, '2026-01-01T00:00:00Z')`,
    );
  }
}

/**
 * Seed the synthetic `cloud-upload` artist + `cloud-lib` album rows the legacy
 * `tracks` FKs require. Without these, the `INSERT INTO tracks` inside the
 * upload handler will trip the artist/album FK constraint.
 */
function seedLegacyCloudCatalog(handle: TestDbHandle): void {
  handle.mem.public.none(
    "INSERT INTO artists (id, name, artwork, genres_json) VALUES ('cloud-upload', 'Cloud Upload', '', '[]')",
  );
  handle.mem.public.none(
    "INSERT INTO albums (id, title, artist_id, artwork, year, genre, source) VALUES ('cloud-lib', 'Cloud Library', 'cloud-upload', '', 2024, 'Upload', 'cloud')",
  );
}

/**
 * A failing stream-control adapter — exercises the 502 / 500 branches.
 */
function failingAdapter(opts: {
  failOn: 'start' | 'stop' | 'metadata';
  mode: 'throw' | 'returnNotOk';
  message?: string;
}): StreamControlAdapter {
  const message = opts.message ?? 'simulated adapter failure';
  const passThrough = async (): Promise<StreamStatus> => ({
    connected: false,
    mountPoint: null,
    listeners: 0,
    bitrate: null,
    uptimeSeconds: 0,
    source: 'stub',
  });
  return {
    async start(_stationId) {
      if (opts.failOn !== 'start') return { ok: true };
      if (opts.mode === 'throw') throw new Error(message);
      return { ok: false, error: message };
    },
    async stop(_stationId) {
      if (opts.failOn !== 'stop') return { ok: true };
      if (opts.mode === 'throw') throw new Error(message);
      return { ok: false, error: message };
    },
    async updateMetadata(_stationId, _meta: StreamMetadata) {
      if (opts.failOn !== 'metadata') return { ok: true };
      if (opts.mode === 'throw') throw new Error(message);
      return { ok: false, error: message };
    },
    status: passThrough,
  };
}

// ---------------------------------------------------------------------------
// POST /api/stream/start
// ---------------------------------------------------------------------------

describe('POST /api/stream/start', () => {
  test('401 when AUTH_JWT_SECRET is missing', async () => {
    const { handle, user } = seed();
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/start',
      method: 'POST',
    });
    const res = await postStreamStart(request, {
      db: handle.db,
      secret: '',
    });
    expect(res.status).toBe(401);
  });

  test('401 when no session cookie', async () => {
    const { handle } = seed();
    const res = await postStreamStart(
      new Request('http://localhost/api/stream/start', { method: 'POST' }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('403 when no station membership', async () => {
    const handle = createTestDb();
    // Seed user without a station_members row.
    handle.mem.public.none(
      "INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('u-orphan', 'orphan', 'pbkdf2:1:00:00', '2026-01-01T00:00:00Z')",
    );
    const request = await buildAuthedRequest('u-orphan', 'orphan', {
      url: 'http://localhost/api/stream/start',
      method: 'POST',
    });
    const res = await postStreamStart(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('403 when role is guest_vt (not admin/producer)', async () => {
    const { handle, user } = seed({ role: 'guest_vt' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/start',
      method: 'POST',
    });
    const res = await postStreamStart(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Insufficient role for stream control');
  });

  test('200 + connected=true when admin starts stream, writes audit_log', async () => {
    const { handle, user } = seed({ role: 'admin' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/start',
      method: 'POST',
    });
    const res = await postStreamStart(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      status: { connected: boolean; source: string };
    };
    expect(body.ok).toBe(true);
    expect(body.status.connected).toBe(true);
    expect(body.status.source).toBe('stub');

    const audit = handle.mem.public.many(
      "SELECT action, target_type, target_id, actor_user_id FROM audit_log WHERE action = 'stream_start'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('stream_start');
    expect(audit[0].target_type).toBe('station');
    expect(audit[0].target_id).toBe(user.stationId);
    expect(audit[0].actor_user_id).toBe(user.userId);
  });

  test('200 when producer starts stream', async () => {
    const { handle, user } = seed({ role: 'producer' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/start',
      method: 'POST',
    });
    const res = await postStreamStart(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
  });

  test('502 when adapter returns !ok', async () => {
    const { handle, user } = seed({ role: 'admin' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/start',
      method: 'POST',
    });
    const res = await postStreamStart(request, {
      db: handle.db,
      secret: SECRET,
      streamControl: failingAdapter({
        failOn: 'start',
        mode: 'returnNotOk',
        message: 'upstream encoder rejected',
      }),
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('upstream encoder rejected');
  });

  test('500 when adapter throws', async () => {
    const { handle, user } = seed({ role: 'admin' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/start',
      method: 'POST',
    });
    const res = await postStreamStart(request, {
      db: handle.db,
      secret: SECRET,
      streamControl: failingAdapter({
        failOn: 'start',
        mode: 'throw',
        message: 'boom',
      }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    // H-11: DB/adapter errors are scrubbed from the response body.
    expect(body.error).toBe('Internal server error');
  });
});

// ---------------------------------------------------------------------------
// POST /api/stream/stop
// ---------------------------------------------------------------------------

describe('POST /api/stream/stop', () => {
  test('401 with no session', async () => {
    const { handle } = seed();
    const res = await postStreamStop(
      new Request('http://localhost/api/stream/stop', { method: 'POST' }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('403 when role is operator (only admin/producer can stop)', async () => {
    const { handle, user } = seed({ role: 'operator' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/stop',
      method: 'POST',
    });
    const res = await postStreamStop(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('200 + connected=false when admin stops, writes audit_log', async () => {
    const { handle, user } = seed({ role: 'admin' });
    // Start first so there's something to stop.
    const startReq = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/start',
      method: 'POST',
    });
    await postStreamStart(startReq, { db: handle.db, secret: SECRET });

    const stopReq = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/stop',
      method: 'POST',
    });
    const res = await postStreamStop(stopReq, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      status: { connected: boolean };
    };
    expect(body.ok).toBe(true);
    expect(body.status.connected).toBe(false);

    const audit = handle.mem.public.many(
      "SELECT action FROM audit_log WHERE action = 'stream_stop'",
    );
    expect(audit).toHaveLength(1);
  });

  test('502 when adapter returns !ok', async () => {
    const { handle, user } = seed({ role: 'admin' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/stop',
      method: 'POST',
    });
    const res = await postStreamStop(request, {
      db: handle.db,
      secret: SECRET,
      streamControl: failingAdapter({
        failOn: 'stop',
        mode: 'returnNotOk',
        message: 'cannot stop',
      }),
    });
    expect(res.status).toBe(502);
  });

  test('500 when adapter throws on stop', async () => {
    const { handle, user } = seed({ role: 'admin' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/stop',
      method: 'POST',
    });
    const res = await postStreamStop(request, {
      db: handle.db,
      secret: SECRET,
      streamControl: failingAdapter({
        failOn: 'stop',
        mode: 'throw',
        message: 'kaboom',
      }),
    });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// GET /api/stream/status
// ---------------------------------------------------------------------------

describe('GET /api/stream/status', () => {
  test('401 with no session', async () => {
    const { handle } = seed();
    const res = await getStreamStatusRoute(
      new Request('http://localhost/api/stream/status'),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('403 when no station membership', async () => {
    const handle = createTestDb();
    handle.mem.public.none(
      "INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('u-orphan', 'orphan', 'pbkdf2:1:00:00', '2026-01-01T00:00:00Z')",
    );
    const request = await buildAuthedRequest('u-orphan', 'orphan', {
      url: 'http://localhost/api/stream/status',
    });
    const res = await getStreamStatusRoute(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('200 + StreamStatus shape for any role (read-only)', async () => {
    const { handle, user } = seed({ role: 'guest_vt' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/status',
    });
    const res = await getStreamStatusRoute(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: StreamStatus };
    expect(body.status).toBeDefined();
    expect(typeof body.status.connected).toBe('boolean');
    expect(body.status.source).toBe('stub');
    expect(body.status.listeners).toBe(0);
  });

  test('does NOT write audit_log', async () => {
    const { handle, user } = seed({ role: 'admin' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/status',
    });
    await getStreamStatusRoute(request, { db: handle.db, secret: SECRET });
    const audit = handle.mem.public.many('SELECT id FROM audit_log');
    expect(audit).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/stream/metadata
// ---------------------------------------------------------------------------

describe('POST /api/stream/metadata', () => {
  test('401 with no session', async () => {
    const { handle } = seed();
    const res = await postStreamMetadata(
      new Request('http://localhost/api/stream/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'X' }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('403 when role is guest_vt', async () => {
    const { handle, user } = seed({ role: 'guest_vt' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/metadata',
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Song' }),
    });
    const res = await postStreamMetadata(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('400 on invalid JSON', async () => {
    const { handle, user } = seed({ role: 'producer' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/metadata',
      method: 'POST',
      contentType: 'application/json',
      body: 'not-json{',
    });
    const res = await postStreamMetadata(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON');
  });

  test('400 when title is missing (Zod)', async () => {
    const { handle, user } = seed({ role: 'producer' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/metadata',
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ artist: 'Solo' }),
    });
    const res = await postStreamMetadata(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; details?: unknown };
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeDefined();
  });

  test('400 when artworkUrl is not a URL', async () => {
    const { handle, user } = seed({ role: 'producer' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/metadata',
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ title: 'X', artworkUrl: 'not-a-url' }),
    });
    const res = await postStreamMetadata(request, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('200 + writes audit_log AND play_log on valid payload', async () => {
    const { handle, user } = seed({ role: 'producer' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/metadata',
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'Song A',
        artist: 'Artist A',
        album: 'Album A',
      }),
    });
    const res = await postStreamMetadata(request, {
      db: handle.db,
      secret: SECRET,
      playLogId: 'pl-fixture-1',
      playLogAt: '2026-05-01T00:00:00Z',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      metadata: { title: string; artist?: string; album?: string };
    };
    expect(body.ok).toBe(true);
    expect(body.metadata.title).toBe('Song A');
    expect(body.metadata.artist).toBe('Artist A');
    expect(body.metadata.album).toBe('Album A');

    const audit = handle.mem.public.many(
      "SELECT action FROM audit_log WHERE action = 'stream_metadata'",
    );
    expect(audit).toHaveLength(1);

    const playLogRows = handle.mem.public.many(
      "SELECT id, station_id, title_snapshot, artist_snapshot, source FROM play_log",
    );
    expect(playLogRows).toHaveLength(1);
    expect(playLogRows[0].station_id).toBe(user.stationId);
    expect(playLogRows[0].title_snapshot).toBe('Song A');
    expect(playLogRows[0].artist_snapshot).toBe('Artist A');
    expect(playLogRows[0].source).toBe('manual');
  });

  test('502 when adapter returns !ok — no play_log row written', async () => {
    const { handle, user } = seed({ role: 'producer' });
    const request = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/stream/metadata',
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ title: 'Song A' }),
    });
    const res = await postStreamMetadata(request, {
      db: handle.db,
      secret: SECRET,
      streamControl: failingAdapter({
        failOn: 'metadata',
        mode: 'returnNotOk',
        message: 'encoder rejected metadata',
      }),
    });
    expect(res.status).toBe(502);
    const playLogRows = handle.mem.public.many('SELECT id FROM play_log');
    expect(playLogRows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /api/tracks/[id]/stream
// ---------------------------------------------------------------------------

describe('GET /api/tracks/[id]/stream', () => {
  // Pentest C-02: handler must call `requireStation` itself; do not rely
  // on the middleware. Every test mints a session cookie now.
  test('401 when no session cookie is present (pentest C-02)', async () => {
    const { handle } = seed();
    const storage = createInMemoryStorage();
    const res = await getTrackStream(
      new Request('http://localhost/api/tracks/whatever/stream'),
      { id: 'whatever' },
      { db: handle.db, storage, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('403 when user has no station membership', async () => {
    const handle = createTestDb();
    // Seed an auth_user only — no station_members row.
    handle.mem.public.none(
      "INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('u-orphan', 'orphan', 'pbkdf2:1:00:00', '2026-01-01T00:00:00Z')",
    );
    const storage = createInMemoryStorage();
    const req = await buildAuthedRequest('u-orphan', 'orphan');
    const res = await getTrackStream(
      req,
      { id: 'whatever' },
      { db: handle.db, storage, secret: SECRET },
    );
    expect(res.status).toBe(403);
  });

  test('400 when id is empty/missing', async () => {
    const { handle, user } = seed();
    const storage = createInMemoryStorage();
    const req = await buildAuthedRequest(user.userId, user.username);
    const res = await getTrackStream(
      req,
      { id: '' },
      { db: handle.db, storage, secret: SECRET },
    );
    expect(res.status).toBe(400);
  });

  test('404 when track row has no media_r2_key', async () => {
    const { handle, user } = seed();
    handle.mem.public.none(
      "INSERT INTO artists (id, name, artwork, genres_json) VALUES ('a1', 'Artist', '', '[]')",
    );
    handle.mem.public.none(
      "INSERT INTO albums (id, title, artist_id, artwork, year, genre, source) VALUES ('al1', 'Album', 'a1', '', 2024, 'pop', 'cloud')",
    );
    handle.mem.public.none(
      "INSERT INTO tracks (id, title, artist_id, album_id, duration, artwork, source, genre, year, track_number) VALUES ('t-no-media', 'Song', 'a1', 'al1', 0, '', 'cloud', 'pop', 2024, 1)",
    );
    const storage = createInMemoryStorage();
    const req = await buildAuthedRequest(user.userId, user.username);
    const res = await getTrackStream(
      req,
      { id: 't-no-media' },
      { db: handle.db, storage, secret: SECRET },
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('No media for track');
  });

  test('404 when storage object is missing for the recorded key', async () => {
    const { handle, user } = seed();
    handle.mem.public.none(
      "INSERT INTO artists (id, name, artwork, genres_json) VALUES ('a1', 'Artist', '', '[]')",
    );
    handle.mem.public.none(
      "INSERT INTO albums (id, title, artist_id, artwork, year, genre, source) VALUES ('al1', 'Album', 'a1', '', 2024, 'pop', 'cloud')",
    );
    handle.mem.public.none(
      "INSERT INTO tracks (id, title, artist_id, album_id, duration, artwork, source, genre, year, track_number, media_r2_key) VALUES ('t-orphan', 'Song', 'a1', 'al1', 0, '', 'cloud', 'pop', 2024, 1, 'uploads/missing/song.mp3')",
    );
    const storage = createInMemoryStorage();
    const req = await buildAuthedRequest(user.userId, user.username);
    const res = await getTrackStream(
      req,
      { id: 't-orphan' },
      { db: handle.db, storage, secret: SECRET },
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Object missing');
  });

  test('200 + audio bytes + Content-Type headers when object exists', async () => {
    const { handle, user } = seed();
    handle.mem.public.none(
      "INSERT INTO artists (id, name, artwork, genres_json) VALUES ('a1', 'Artist', '', '[]')",
    );
    handle.mem.public.none(
      "INSERT INTO albums (id, title, artist_id, artwork, year, genre, source) VALUES ('al1', 'Album', 'a1', '', 2024, 'pop', 'cloud')",
    );
    handle.mem.public.none(
      "INSERT INTO tracks (id, title, artist_id, album_id, duration, artwork, source, genre, year, track_number, media_r2_key) VALUES ('t-ok', 'Song', 'a1', 'al1', 0, '', 'cloud', 'pop', 2024, 1, 'uploads/abc/song.mp3')",
    );
    const audioBody = new Uint8Array([0x52, 0x49, 0x46, 0x46]); // RIFF magic
    const storage = createInMemoryStorage({
      seed: {
        'uploads/abc/song.mp3': {
          body: audioBody,
          contentType: 'audio/mpeg',
        },
      },
    });

    const req = await buildAuthedRequest(user.userId, user.username);
    const res = await getTrackStream(
      req,
      { id: 't-ok' },
      { db: handle.db, storage, secret: SECRET },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('Accept-Ranges')).toBe('bytes');
    expect(res.headers.get('Content-Length')).toBe('4');
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=3600');
    const bodyBytes = new Uint8Array(await res.arrayBuffer());
    expect(bodyBytes).toEqual(audioBody);
  });

  test('503 when storage adapter is unconfigured', async () => {
    const { handle, user } = seed();
    handle.mem.public.none(
      "INSERT INTO artists (id, name, artwork, genres_json) VALUES ('a1', 'Artist', '', '[]')",
    );
    handle.mem.public.none(
      "INSERT INTO albums (id, title, artist_id, artwork, year, genre, source) VALUES ('al1', 'Album', 'a1', '', 2024, 'pop', 'cloud')",
    );
    handle.mem.public.none(
      "INSERT INTO tracks (id, title, artist_id, album_id, duration, artwork, source, genre, year, track_number, media_r2_key) VALUES ('t-503', 'Song', 'a1', 'al1', 0, '', 'cloud', 'pop', 2024, 1, 'uploads/x/y.mp3')",
    );
    // No storage dep ⇒ falls back to the unconfigured stub which throws.
    const req = await buildAuthedRequest(user.userId, user.username);
    const res = await getTrackStream(
      req,
      { id: 't-503' },
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('Media unavailable');
  });

  test('decodes URI-encoded id', async () => {
    const { handle, user } = seed();
    handle.mem.public.none(
      "INSERT INTO artists (id, name, artwork, genres_json) VALUES ('a1', 'Artist', '', '[]')",
    );
    handle.mem.public.none(
      "INSERT INTO albums (id, title, artist_id, artwork, year, genre, source) VALUES ('al1', 'Album', 'a1', '', 2024, 'pop', 'cloud')",
    );
    handle.mem.public.none(
      "INSERT INTO tracks (id, title, artist_id, album_id, duration, artwork, source, genre, year, track_number, media_r2_key) VALUES ('weird id', 'Song', 'a1', 'al1', 0, '', 'cloud', 'pop', 2024, 1, 'uploads/x/y.mp3')",
    );
    const storage = createInMemoryStorage({
      seed: {
        'uploads/x/y.mp3': {
          body: new Uint8Array([1]),
          contentType: 'audio/mpeg',
        },
      },
    });
    const req = await buildAuthedRequest(user.userId, user.username, {
      url: 'http://localhost/api/tracks/weird%20id/stream',
    });
    const res = await getTrackStream(
      req,
      { id: 'weird%20id' },
      { db: handle.db, storage, secret: SECRET },
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /api/upload
// ---------------------------------------------------------------------------

/**
 * Build a multipart upload request signed with the test session.
 *
 * Node's WHATWG `FormData` + `Request` correctly stringifies multipart
 * bodies for us — no need for the jsdom polyfill the Cloudflare suite
 * had to ship.
 *
 * Prepends a valid ID3v2 magic prefix (49 44 33) so the bytes pass the
 * H-04 magic-byte sniff. The rest of the body is the supplied string.
 */
async function buildUploadRequest(
  user: SeededUser,
  filename: string,
  mime: string,
  body: string,
): Promise<Request> {
  // Prepend ID3 magic bytes so the file passes audio magic-byte sniffing.
  const id3Magic = new Uint8Array([0x49, 0x44, 0x33]); // ID3
  const bodyBytes = new TextEncoder().encode(body);
  const combined = new Uint8Array(id3Magic.length + bodyBytes.length);
  combined.set(id3Magic, 0);
  combined.set(bodyBytes, id3Magic.length);

  const fd = new FormData();
  fd.append('file', new File([combined], filename, { type: mime }));
  const token = await signSessionToken(SECRET, {
    sub: user.userId,
    username: user.username,
  });
  return new Request('http://localhost/api/upload', {
    method: 'POST',
    headers: {
      Cookie: `${sessionCookieName()}=${encodeURIComponent(token)}`,
    },
    body: fd,
  });
}

/**
 * Build a multipart upload request with raw binary bytes.
 * Used for magic-byte and size-cap tests.
 */
async function buildUploadRequestWithBytes(
  user: SeededUser,
  filename: string,
  mime: string,
  bytes: Uint8Array,
  extraHeaders: Record<string, string> = {},
): Promise<Request> {
  const fd = new FormData();
  // Cast to BlobPart: newer lib.dom types reject Uint8Array<ArrayBufferLike>
  // as a BlobPart generic even though it is valid at runtime.
  fd.append('file', new File([bytes as BlobPart], filename, { type: mime }));
  const token = await signSessionToken(SECRET, {
    sub: user.userId,
    username: user.username,
  });
  return new Request('http://localhost/api/upload', {
    method: 'POST',
    headers: {
      Cookie: `${sessionCookieName()}=${encodeURIComponent(token)}`,
      ...extraHeaders,
    },
    body: fd,
  });
}

describe('POST /api/upload', () => {
  test('400 when content-type is not multipart', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    const token = await signSessionToken(SECRET, {
      sub: user.userId,
      username: user.username,
    });
    const res = await postUpload(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `${sessionCookieName()}=${encodeURIComponent(token)}`,
        },
        body: JSON.stringify({}),
      }),
      {
        db: handle.db,
        secret: SECRET,
        storage: createInMemoryStorage(),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Expected multipart/form-data');
  });

  test('401 with no session — no storage put, no DB insert', async () => {
    const { handle } = seed();
    seedDefaultCategories(handle, 'station-test');
    const fd = new FormData();
    fd.append('file', new File(['x'], 'song.mp3', { type: 'audio/mpeg' }));
    const storage = createInMemoryStorage();
    const res = await postUpload(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        body: fd,
      }),
      { db: handle.db, secret: SECRET, storage },
    );
    expect(res.status).toBe(401);
    expect(storage.puts).toHaveLength(0);
    const rows = handle.mem.public.many('SELECT id FROM radio_tracks');
    expect(rows).toHaveLength(0);
  });

  test('400 when file field is missing', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    const fd = new FormData();
    fd.append('not-file', 'something');
    const token = await signSessionToken(SECRET, {
      sub: user.userId,
      username: user.username,
    });
    const res = await postUpload(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: {
          Cookie: `${sessionCookieName()}=${encodeURIComponent(token)}`,
        },
        body: fd,
      }),
      {
        db: handle.db,
        secret: SECRET,
        storage: createInMemoryStorage(),
      },
    );
    expect(res.status).toBe(400);
  });

  test('200 + writes file to storage under uploads/<id>/<safeName>', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    seedLegacyCloudCatalog(handle);
    const storage = createInMemoryStorage();
    const req = await buildUploadRequest(
      user,
      'song.mp3',
      'audio/mpeg',
      'fake-audio-bytes',
    );
    const res = await postUpload(req, {
      db: handle.db,
      secret: SECRET,
      storage,
      generateId: () => 'fixed-upload-id',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      id: string;
      key?: string;
      size: number;
      trackId: string;
    };
    expect(body.ok).toBe(true);
    // Pentest M-08: storage key MUST NOT appear in response body.
    expect(body.key).toBeUndefined();
    // The key still flows through to storage — assert there instead.
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0].key).toBe('uploads/fixed-upload-id/song.mp3');
    expect(storage.puts[0].contentType).toBe('audio/mpeg');
  });

  test('inserts radio_tracks row scoped to the user station', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    seedLegacyCloudCatalog(handle);
    const req = await buildUploadRequest(
      user,
      'song.mp3',
      'audio/mpeg',
      'unique-bytes-for-this-test',
    );
    const res = await postUpload(req, {
      db: handle.db,
      secret: SECRET,
      storage: createInMemoryStorage(),
    });
    expect(res.status).toBe(200);

    const rt = handle.mem.public.many(
      'SELECT id, station_id, title, category_id, file_type FROM radio_tracks',
    );
    expect(rt).toHaveLength(1);
    expect(rt[0].station_id).toBe(user.stationId);
    expect(rt[0].title).toBe('song');
    expect(rt[0].category_id).toBe('cat-music');
    expect(rt[0].file_type).toBe('music');
  });

  test('sweeper-named filename → file_type=sweeper, category=cat-sweeper', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    seedLegacyCloudCatalog(handle);
    const req = await buildUploadRequest(
      user,
      'sweeper-promo.mp3',
      'audio/mpeg',
      'sweeper-bytes',
    );
    const res = await postUpload(req, {
      db: handle.db,
      secret: SECRET,
      storage: createInMemoryStorage(),
    });
    expect(res.status).toBe(200);
    const rt = handle.mem.public.many(
      'SELECT category_id, file_type FROM radio_tracks',
    );
    expect(rt[0].category_id).toBe('cat-sweeper');
    expect(rt[0].file_type).toBe('sweeper');
  });

  test('duplicate content-hash returns deduped:true, no second storage put', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    seedLegacyCloudCatalog(handle);
    const storage = createInMemoryStorage();
    const bytes = 'identical-bytes-duplicate-test';

    const first = await postUpload(
      await buildUploadRequest(user, 'a.mp3', 'audio/mpeg', bytes),
      { db: handle.db, secret: SECRET, storage },
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { trackId: string };

    const second = await postUpload(
      await buildUploadRequest(user, 'b.mp3', 'audio/mpeg', bytes),
      { db: handle.db, secret: SECRET, storage },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      deduped?: boolean;
      trackId?: string;
    };
    expect(secondBody.deduped).toBe(true);
    expect(secondBody.trackId).toBe(firstBody.trackId);

    // Storage was only written ONCE (the first upload).
    expect(storage.puts).toHaveLength(1);
    // Only one radio_tracks row exists.
    const rt = handle.mem.public.many('SELECT id FROM radio_tracks');
    expect(rt).toHaveLength(1);
  });

  test('legacy tracks + media_objects rows are written for back-compat', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    seedLegacyCloudCatalog(handle);

    const req = await buildUploadRequest(
      user,
      'song.mp3',
      'audio/mpeg',
      'legacy-bytes-1',
    );
    const res = await postUpload(req, {
      db: handle.db,
      secret: SECRET,
      storage: createInMemoryStorage(),
    });
    expect(res.status).toBe(200);

    const legacy = handle.mem.public.many("SELECT id, source FROM tracks WHERE source = 'cloud'");
    expect(legacy).toHaveLength(1);

    const media = handle.mem.public.many('SELECT id, r2_key FROM media_objects');
    expect(media).toHaveLength(1);
    expect(String(media[0].r2_key)).toMatch(/^uploads\//);
  });

  test('returns 500 + compensating storage.delete on legacy tracks insert failure', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    // Do NOT seed `cloud-upload` artist — the legacy insert will FK-fail.
    const storage = createInMemoryStorage();
    const req = await buildUploadRequest(
      user,
      'song.mp3',
      'audio/mpeg',
      'failing-bytes-1',
    );
    const res = await postUpload(req, {
      db: handle.db,
      secret: SECRET,
      storage,
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Database write failed');
    // Compensating delete must have run.
    expect(storage.deletes).toHaveLength(1);
    expect(storage.deletes[0]).toMatch(/^uploads\//);
  });

  test('dev fallback when storage adapter is unconfigured', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    const req = await buildUploadRequest(
      user,
      'song.mp3',
      'audio/mpeg',
      'dev-fallback-bytes',
    );
    // No `storage` dep ⇒ falls back to getStorage() which is unconfigured.
    const res = await postUpload(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      warning?: string;
      key: string;
    };
    expect(body.ok).toBe(true);
    expect(body.warning).toBe('R2 or D1 not bound — dev fallback only');
    expect(body.key).toMatch(/^dev\//);
  });

  // -------------------------------------------------------------------------
  // H-03: Upload size cap tests
  // -------------------------------------------------------------------------

  test('413 when Content-Length header exceeds MAX_UPLOAD_BYTES', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    const token = await signSessionToken(SECRET, {
      sub: user.userId,
      username: user.username,
    });
    // Fabricate a request with an oversized Content-Length header.
    // The body itself is small — the guard fires on the header alone.
    const fd = new FormData();
    fd.append('file', new File(['x'], 'big.mp3', { type: 'audio/mpeg' }));
    const res = await postUpload(
      new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: {
          Cookie: `${sessionCookieName()}=${encodeURIComponent(token)}`,
          'Content-Length': String(MAX_UPLOAD_BYTES + 1),
        },
        body: fd,
      }),
      { db: handle.db, secret: SECRET, storage: createInMemoryStorage() },
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; maxBytes: number };
    expect(body.error).toBe('Upload too large');
    expect(body.maxBytes).toBe(MAX_UPLOAD_BYTES);
  });

  test('413 when actual file bytes exceed MAX_UPLOAD_BYTES (no Content-Length)', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    seedLegacyCloudCatalog(handle);

    // Build a byte array just over the limit with valid MP3 magic bytes at the start.
    // The mp3MagicPrefix is padded to just over MAX_UPLOAD_BYTES.
    const oversizedBytes = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    // ID3 header magic bytes so MIME check passes
    oversizedBytes[0] = 0x49; // I
    oversizedBytes[1] = 0x44; // D
    oversizedBytes[2] = 0x33; // 3

    const req = await buildUploadRequestWithBytes(
      user,
      'huge.mp3',
      'audio/mpeg',
      oversizedBytes,
    );
    const res = await postUpload(req, {
      db: handle.db,
      secret: SECRET,
      storage: createInMemoryStorage(),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: string; maxBytes: number };
    expect(body.error).toBe('Upload too large');
    expect(body.maxBytes).toBe(MAX_UPLOAD_BYTES);
  });

  // -------------------------------------------------------------------------
  // H-04: MIME allowlist and magic-byte sniffing tests
  // -------------------------------------------------------------------------

  test('415 when file MIME type is not in the audio allowlist', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    const req = await buildUploadRequestWithBytes(
      user,
      'malware.html',
      'text/html',
      new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]), // <html>
    );
    const res = await postUpload(req, {
      db: handle.db,
      secret: SECRET,
      storage: createInMemoryStorage(),
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as {
      error: string;
      contentType: string;
      allowed: string[];
    };
    expect(body.error).toBe('Audio MIME type not allowed');
    expect(body.contentType).toBe('text/html');
    expect(Array.isArray(body.allowed)).toBe(true);
  });

  test('415 when file passes MIME check but magic bytes are not audio (H-04 sniff)', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    // Declare audio/mpeg but the bytes are just ASCII HTML — no audio magic signature.
    const htmlBytes = new TextEncoder().encode('<html><body>hello</body></html>');
    const req = await buildUploadRequestWithBytes(
      user,
      'fake.mp3',
      'audio/mpeg',
      htmlBytes,
    );
    const res = await postUpload(req, {
      db: handle.db,
      secret: SECRET,
      storage: createInMemoryStorage(),
    });
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('File content is not a recognized audio format');
  });

  test('200 with valid audio MIME and correct magic bytes (regression check)', async () => {
    const { handle, user } = seed({ role: 'admin' });
    seedDefaultCategories(handle, user.stationId);
    seedLegacyCloudCatalog(handle);

    // RIFF WAVE magic: bytes 0-3 = RIFF, bytes 8-11 = WAVE, padded to 16 bytes
    const wavBytes = new Uint8Array(16);
    wavBytes[0] = 0x52; // R
    wavBytes[1] = 0x49; // I
    wavBytes[2] = 0x46; // F
    wavBytes[3] = 0x46; // F
    // bytes 4-7: chunk size (any value)
    wavBytes[4] = 0x10;
    wavBytes[5] = 0x00;
    wavBytes[6] = 0x00;
    wavBytes[7] = 0x00;
    wavBytes[8] = 0x57;  // W
    wavBytes[9] = 0x41;  // A
    wavBytes[10] = 0x56; // V
    wavBytes[11] = 0x45; // E

    const storage = createInMemoryStorage();
    const req = await buildUploadRequestWithBytes(
      user,
      'real-audio.wav',
      'audio/wav',
      wavBytes,
    );
    const res = await postUpload(req, {
      db: handle.db,
      secret: SECRET,
      storage,
      generateId: () => 'wav-upload-id',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; key?: string };
    expect(body.ok).toBe(true);
    // Pentest M-08: storage key absent from response body; assert via storage adapter.
    expect(body.key).toBeUndefined();
    expect(storage.puts).toHaveLength(1);
    expect(storage.puts[0].key).toBe('uploads/wav-upload-id/real-audio.wav');
  });
});
