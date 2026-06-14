// @vitest-environment node
// Route handlers use `jose` (HS256) via require-station; pg-mem via Drizzle
// for the DB layer. See routes-beta1.test.ts for the harness conventions.

/**
 * Wave RM-β6 — Reports, audit-log, and play-log Next.js Route Handlers.
 *
 * For each handler we exercise the input → output contract its Cloudflare
 * counterpart established. The goal is byte-identical responses for the
 * dual-stack window. Aggregation shapes especially must match — the UI
 * binds tightly to `{ overview, range }`, `{ days, range, source }`, etc.
 */

import { describe, expect, test } from 'vitest';

import { getAuditLog } from '@/app/api/audit-log/route-impl';
import { getPlayLog, postPlayLog } from '@/app/api/play-log/route-impl';
import { getReportsListeningSummary } from '@/app/api/reports/listening-summary/route-impl';
import { getReportsOverview } from '@/app/api/reports/overview/route-impl';
import { getReportsPlaysByDay } from '@/app/api/reports/plays-by-day/route-impl';
import { getReportsTopHours } from '@/app/api/reports/top-hours/route-impl';
import { getReportsTopTracks } from '@/app/api/reports/top-tracks/route-impl';
import {
  sessionCookieName,
  signSessionToken,
} from '@/server/auth/session-jwt';
import {
  createTestDb,
  createTestDbWithUser,
  type TestDbHandle,
} from '@/server/test-utils/db';

const SECRET = 'beta6-test-secret';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

async function authedRequest(
  url: string,
  userId: string,
  username: string,
  init: RequestInit = {},
): Promise<Request> {
  const token = await signSessionToken(SECRET, { sub: userId, username });
  const headers = new Headers(init.headers);
  headers.set(
    'Cookie',
    `${sessionCookieName()}=${encodeURIComponent(token)}`,
  );
  return new Request(url, { ...init, headers });
}

async function setupAuthed(): Promise<{
  handle: TestDbHandle;
  userId: string;
  stationId: string;
  username: string;
}> {
  const { handle, user } = createTestDbWithUser();
  return {
    handle,
    userId: user.userId,
    stationId: user.stationId,
    username: user.username,
  };
}

function escSql(s: string): string {
  return s.replace(/'/g, "''");
}

interface PlayLogSeed {
  id: string;
  stationId: string;
  title: string;
  artist?: string | null;
  playedAt: string;
  source?: string;
  durationPlayedMs?: number | null;
  trackId?: string | null;
}

function seedPlayLog(handle: TestDbHandle, rows: PlayLogSeed[]): void {
  for (const r of rows) {
    const cols: string[] = [
      'id',
      'station_id',
      'title_snapshot',
      'played_at',
      'source',
    ];
    const vals: string[] = [
      `'${escSql(r.id)}'`,
      `'${escSql(r.stationId)}'`,
      `'${escSql(r.title)}'`,
      `'${escSql(r.playedAt)}'`,
      `'${escSql(r.source ?? 'automation')}'`,
    ];
    if (r.artist !== undefined) {
      cols.push('artist_snapshot');
      vals.push(r.artist === null ? 'NULL' : `'${escSql(r.artist)}'`);
    }
    if (r.durationPlayedMs !== undefined) {
      cols.push('duration_played_ms');
      vals.push(
        r.durationPlayedMs === null ? 'NULL' : String(r.durationPlayedMs),
      );
    }
    if (r.trackId !== undefined) {
      cols.push('track_id');
      vals.push(r.trackId === null ? 'NULL' : `'${escSql(r.trackId)}'`);
    }
    handle.mem.public.none(
      `INSERT INTO play_log (${cols.join(', ')}) VALUES (${vals.join(', ')})`,
    );
  }
}

interface AuditLogSeed {
  id: string;
  stationId: string;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  at: string;
  beforeJson?: string | null;
  afterJson?: string | null;
}

function seedAuditLog(handle: TestDbHandle, rows: AuditLogSeed[]): void {
  for (const r of rows) {
    handle.mem.public.none(
      `INSERT INTO audit_log (id, station_id, actor_user_id, action, target_type, target_id, before_json, after_json, at)
       VALUES (
         '${escSql(r.id)}',
         '${escSql(r.stationId)}',
         ${r.actorUserId === undefined || r.actorUserId === null ? 'NULL' : `'${escSql(r.actorUserId)}'`},
         '${escSql(r.action)}',
         '${escSql(r.targetType)}',
         '${escSql(r.targetId)}',
         ${r.beforeJson === undefined || r.beforeJson === null ? 'NULL' : `'${escSql(r.beforeJson)}'`},
         ${r.afterJson === undefined || r.afterJson === null ? 'NULL' : `'${escSql(r.afterJson)}'`},
         '${escSql(r.at)}'
       )`,
    );
  }
}

// ===========================================================================
// /api/reports/overview
// ===========================================================================

describe('GET /api/reports/overview', () => {
  test('401 when no session cookie', async () => {
    const { db } = createTestDb();
    const res = await getReportsOverview(
      new Request('http://localhost/api/reports/overview'),
      { db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('returns zeroed overview on empty play_log', async () => {
    const { handle, userId, username } = await setupAuthed();
    const req = await authedRequest(
      'http://localhost/api/reports/overview',
      userId,
      username,
    );
    const res = await getReportsOverview(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      overview: {
        totalPlays: number;
        uniqueTitles: number;
        daysWithActivity: number;
        totalListeningHours: number;
      };
      range: { from: string | null; to: string | null };
    };
    expect(body.overview.totalPlays).toBe(0);
    expect(body.overview.uniqueTitles).toBe(0);
    expect(body.overview.daysWithActivity).toBe(0);
    expect(body.overview.totalListeningHours).toBe(0);
    expect(body.range.from).toBeNull();
    expect(body.range.to).toBeNull();
  });

  test('aggregates plays across multiple seeded rows', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      {
        id: 'p-1',
        stationId,
        title: 'Song A',
        artist: 'Artist A',
        playedAt: '2026-05-01T08:00:00Z',
        durationPlayedMs: 180_000,
      },
      {
        id: 'p-2',
        stationId,
        title: 'Song B',
        artist: 'Artist B',
        playedAt: '2026-05-01T09:00:00Z',
        durationPlayedMs: 240_000,
      },
      {
        // Same title+artist as p-1 → not a unique title.
        id: 'p-3',
        stationId,
        title: 'Song A',
        artist: 'Artist A',
        playedAt: '2026-05-02T10:00:00Z',
        durationPlayedMs: 120_000,
      },
    ]);

    const req = await authedRequest(
      'http://localhost/api/reports/overview',
      userId,
      username,
    );
    const res = await getReportsOverview(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      overview: {
        totalPlays: number;
        uniqueTitles: number;
        daysWithActivity: number;
        totalListeningHours: number;
      };
    };
    expect(body.overview.totalPlays).toBe(3);
    expect(body.overview.uniqueTitles).toBe(2);
    expect(body.overview.daysWithActivity).toBe(2);
    expect(body.overview.totalListeningHours).toBeCloseTo(
      540_000 / 3_600_000,
      5,
    );
  });

  test('range filter trims to the [from, to) window', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      {
        id: 'p-1',
        stationId,
        title: 'A',
        playedAt: '2026-04-30T23:00:00Z',
      },
      {
        id: 'p-2',
        stationId,
        title: 'B',
        playedAt: '2026-05-01T08:00:00Z',
      },
      {
        id: 'p-3',
        stationId,
        title: 'C',
        playedAt: '2026-05-02T08:00:00Z',
      },
    ]);

    const req = await authedRequest(
      'http://localhost/api/reports/overview?from=2026-05-01T00:00:00Z&to=2026-05-02T00:00:00Z',
      userId,
      username,
    );
    const res = await getReportsOverview(req, {
      db: handle.db,
      secret: SECRET,
    });
    const body = (await res.json()) as {
      overview: { totalPlays: number };
      range: { from: string; to: string };
    };
    expect(body.overview.totalPlays).toBe(1);
    expect(body.range.from).toBe('2026-05-01T00:00:00Z');
    expect(body.range.to).toBe('2026-05-02T00:00:00Z');
  });

  test('400 on malformed query params', async () => {
    const { handle, userId, username } = await setupAuthed();
    const req = await authedRequest(
      'http://localhost/api/reports/overview?from=not-a-date',
      userId,
      username,
    );
    const res = await getReportsOverview(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// /api/reports/listening-summary
// ===========================================================================

describe('GET /api/reports/listening-summary', () => {
  test('returns overview + source breakdown together', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      {
        id: 'p-1',
        stationId,
        title: 'A',
        playedAt: '2026-05-01T00:00:00Z',
        source: 'automation',
        durationPlayedMs: 60_000,
      },
      {
        id: 'p-2',
        stationId,
        title: 'B',
        playedAt: '2026-05-01T01:00:00Z',
        source: 'automation',
        durationPlayedMs: 60_000,
      },
      {
        id: 'p-3',
        stationId,
        title: 'C',
        playedAt: '2026-05-01T02:00:00Z',
        source: 'manual',
        durationPlayedMs: 60_000,
      },
    ]);

    const req = await authedRequest(
      'http://localhost/api/reports/listening-summary',
      userId,
      username,
    );
    const res = await getReportsListeningSummary(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: {
        totalPlays: number;
        totalListeningHours: number;
        sourceBreakdown: Array<{ source: string; plays: number }>;
      };
      range: { from: string | null; to: string | null };
    };
    expect(body.summary.totalPlays).toBe(3);
    expect(body.summary.totalListeningHours).toBeCloseTo(180_000 / 3_600_000, 5);
    // Sorted by plays DESC
    expect(body.summary.sourceBreakdown).toEqual([
      { source: 'automation', plays: 2 },
      { source: 'manual', plays: 1 },
    ]);
  });

  test('empty source breakdown when no rows', async () => {
    const { handle, userId, username } = await setupAuthed();
    const req = await authedRequest(
      'http://localhost/api/reports/listening-summary',
      userId,
      username,
    );
    const res = await getReportsListeningSummary(req, {
      db: handle.db,
      secret: SECRET,
    });
    const body = (await res.json()) as {
      summary: { sourceBreakdown: unknown[] };
    };
    expect(body.summary.sourceBreakdown).toEqual([]);
  });
});

// ===========================================================================
// /api/reports/plays-by-day
// ===========================================================================

describe('GET /api/reports/plays-by-day', () => {
  test('groups by ISO date prefix, sorted ascending', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      { id: 'p-1', stationId, title: 'A', playedAt: '2026-05-03T01:00:00Z' },
      { id: 'p-2', stationId, title: 'B', playedAt: '2026-05-01T01:00:00Z' },
      { id: 'p-3', stationId, title: 'C', playedAt: '2026-05-01T23:59:59Z' },
      { id: 'p-4', stationId, title: 'D', playedAt: '2026-05-02T12:00:00Z' },
    ]);

    const req = await authedRequest(
      'http://localhost/api/reports/plays-by-day',
      userId,
      username,
    );
    const res = await getReportsPlaysByDay(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      days: Array<{ day: string; plays: number }>;
      source: string | null;
    };
    expect(body.days).toEqual([
      { day: '2026-05-01', plays: 2 },
      { day: '2026-05-02', plays: 1 },
      { day: '2026-05-03', plays: 1 },
    ]);
    expect(body.source).toBeNull();
  });

  test('source filter narrows to matching rows', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      {
        id: 'p-1',
        stationId,
        title: 'A',
        playedAt: '2026-05-01T01:00:00Z',
        source: 'automation',
      },
      {
        id: 'p-2',
        stationId,
        title: 'B',
        playedAt: '2026-05-01T02:00:00Z',
        source: 'manual',
      },
    ]);

    const req = await authedRequest(
      'http://localhost/api/reports/plays-by-day?source=manual',
      userId,
      username,
    );
    const res = await getReportsPlaysByDay(req, {
      db: handle.db,
      secret: SECRET,
    });
    const body = (await res.json()) as {
      days: Array<{ day: string; plays: number }>;
      source: string;
    };
    expect(body.days).toEqual([{ day: '2026-05-01', plays: 1 }]);
    expect(body.source).toBe('manual');
  });

  test('rejects unknown source via Zod enum', async () => {
    const { handle, userId, username } = await setupAuthed();
    const req = await authedRequest(
      'http://localhost/api/reports/plays-by-day?source=bogus',
      userId,
      username,
    );
    const res = await getReportsPlaysByDay(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// /api/reports/top-hours
// ===========================================================================

describe('GET /api/reports/top-hours', () => {
  test('zero-fills to 24 buckets even with sparse data', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      { id: 'p-1', stationId, title: 'A', playedAt: '2026-05-01T03:30:00Z' },
      { id: 'p-2', stationId, title: 'B', playedAt: '2026-05-01T03:31:00Z' },
      { id: 'p-3', stationId, title: 'C', playedAt: '2026-05-01T21:00:00Z' },
    ]);

    const req = await authedRequest(
      'http://localhost/api/reports/top-hours',
      userId,
      username,
    );
    const res = await getReportsTopHours(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hours: Array<{ hour: number; plays: number }>;
    };
    expect(body.hours).toHaveLength(24);
    expect(body.hours[0]).toEqual({ hour: 0, plays: 0 });
    expect(body.hours[3]).toEqual({ hour: 3, plays: 2 });
    expect(body.hours[21]).toEqual({ hour: 21, plays: 1 });
    expect(body.hours[23]).toEqual({ hour: 23, plays: 0 });
  });

  test('range filter restricts the population', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      { id: 'p-1', stationId, title: 'A', playedAt: '2026-05-01T03:30:00Z' },
      { id: 'p-2', stationId, title: 'B', playedAt: '2026-05-02T03:30:00Z' },
    ]);

    const req = await authedRequest(
      'http://localhost/api/reports/top-hours?from=2026-05-02T00:00:00Z&to=2026-05-03T00:00:00Z',
      userId,
      username,
    );
    const res = await getReportsTopHours(req, {
      db: handle.db,
      secret: SECRET,
    });
    const body = (await res.json()) as {
      hours: Array<{ hour: number; plays: number }>;
    };
    expect(body.hours[3]).toEqual({ hour: 3, plays: 1 });
  });
});

// ===========================================================================
// /api/reports/top-tracks
// ===========================================================================

describe('GET /api/reports/top-tracks', () => {
  test('returns title/artist/plays sorted by plays DESC, tie-broken by title ASC', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      { id: 'p-1', stationId, title: 'Apple', artist: 'X', playedAt: '2026-05-01T00:00:00Z' },
      { id: 'p-2', stationId, title: 'Apple', artist: 'X', playedAt: '2026-05-01T01:00:00Z' },
      { id: 'p-3', stationId, title: 'Apple', artist: 'X', playedAt: '2026-05-01T02:00:00Z' },
      { id: 'p-4', stationId, title: 'Banana', artist: 'Y', playedAt: '2026-05-01T03:00:00Z' },
      { id: 'p-5', stationId, title: 'Banana', artist: 'Y', playedAt: '2026-05-01T04:00:00Z' },
      { id: 'p-6', stationId, title: 'Carrot', artist: 'Z', playedAt: '2026-05-01T05:00:00Z' },
      { id: 'p-7', stationId, title: 'Carrot', artist: 'Z', playedAt: '2026-05-01T06:00:00Z' },
    ]);

    const req = await authedRequest(
      'http://localhost/api/reports/top-tracks',
      userId,
      username,
    );
    const res = await getReportsTopTracks(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tracks: Array<{ title: string; artist: string | null; plays: number }>;
      limit: number;
    };
    expect(body.tracks).toEqual([
      { title: 'Apple', artist: 'X', plays: 3 },
      { title: 'Banana', artist: 'Y', plays: 2 },
      { title: 'Carrot', artist: 'Z', plays: 2 },
    ]);
    expect(body.limit).toBe(25);
  });

  test('limit param is clamped to the configured maximum', async () => {
    const { handle, userId, username } = await setupAuthed();
    const req = await authedRequest(
      'http://localhost/api/reports/top-tracks?limit=99999',
      userId,
      username,
    );
    const res = await getReportsTopTracks(req, {
      db: handle.db,
      secret: SECRET,
    });
    const body = (await res.json()) as { limit: number };
    expect(body.limit).toBe(200);
  });

  test('limit honours an explicit small value', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      { id: 'p-1', stationId, title: 'A', playedAt: '2026-05-01T00:00:00Z' },
      { id: 'p-2', stationId, title: 'B', playedAt: '2026-05-01T01:00:00Z' },
      { id: 'p-3', stationId, title: 'C', playedAt: '2026-05-01T02:00:00Z' },
    ]);
    const req = await authedRequest(
      'http://localhost/api/reports/top-tracks?limit=2',
      userId,
      username,
    );
    const res = await getReportsTopTracks(req, {
      db: handle.db,
      secret: SECRET,
    });
    const body = (await res.json()) as {
      tracks: Array<{ title: string }>;
      limit: number;
    };
    expect(body.limit).toBe(2);
    expect(body.tracks).toHaveLength(2);
  });
});

// ===========================================================================
// /api/audit-log
// ===========================================================================

describe('GET /api/audit-log', () => {
  test('401 with no session cookie', async () => {
    const { db } = createTestDb();
    const res = await getAuditLog(
      new Request('http://localhost/api/audit-log'),
      { db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('pentest M-15: 403 when role is operator (not admin/programmer)', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'operator' });
    const req = await authedRequest(
      'http://localhost/api/audit-log',
      user.userId,
      user.username,
    );
    const res = await getAuditLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(403);
  });

  test('pentest M-15: 403 when role is producer', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'producer' });
    const req = await authedRequest(
      'http://localhost/api/audit-log',
      user.userId,
      user.username,
    );
    const res = await getAuditLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(403);
  });

  test('pentest M-15: 200 when role is programmer', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'programmer' });
    const req = await authedRequest(
      'http://localhost/api/audit-log',
      user.userId,
      user.username,
    );
    const res = await getAuditLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
  });

  test('returns entries newest-first with action filter applied', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedAuditLog(handle, [
      {
        id: 'a-1',
        stationId,
        actorUserId: userId,
        action: 'create',
        targetType: 'clock',
        targetId: 'c-1',
        at: '2026-05-01T00:00:00Z',
        afterJson: '{"name":"Drive"}',
      },
      {
        id: 'a-2',
        stationId,
        actorUserId: userId,
        action: 'update',
        targetType: 'clock',
        targetId: 'c-1',
        at: '2026-05-02T00:00:00Z',
        beforeJson: '{"name":"Drive"}',
        afterJson: '{"name":"Drive Time"}',
      },
      {
        id: 'a-3',
        stationId,
        actorUserId: userId,
        action: 'create',
        targetType: 'clock',
        targetId: 'c-2',
        at: '2026-05-03T00:00:00Z',
      },
    ]);

    const req = await authedRequest(
      'http://localhost/api/audit-log?action=create',
      userId,
      username,
    );
    const res = await getAuditLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{
        id: string;
        at: string;
        action: string;
        actor: { userId: string | null; username: string | null };
        before: unknown;
        after: unknown;
      }>;
      meta: { nextCursor: string | null; limit: number };
    };
    expect(body.entries.map((e) => e.id)).toEqual(['a-3', 'a-1']);
    expect(body.entries[0].actor.userId).toBe(userId);
    expect(body.entries[0].actor.username).toBe(username);
    expect(body.entries[1].after).toEqual({ name: 'Drive' });
    expect(body.meta.limit).toBe(50);
    expect(body.meta.nextCursor).toBeNull();
  });

  test('limit + cursor paginate from newest to oldest', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    const rows: AuditLogSeed[] = [];
    for (let i = 1; i <= 5; i += 1) {
      rows.push({
        id: `a-${i}`,
        stationId,
        actorUserId: userId,
        action: 'update',
        targetType: 'clock',
        targetId: 'c-1',
        at: `2026-05-0${i}T00:00:00Z`,
      });
    }
    seedAuditLog(handle, rows);

    const firstReq = await authedRequest(
      'http://localhost/api/audit-log?limit=2',
      userId,
      username,
    );
    const firstRes = await getAuditLog(firstReq, {
      db: handle.db,
      secret: SECRET,
    });
    const firstBody = (await firstRes.json()) as {
      entries: Array<{ id: string }>;
      meta: { nextCursor: string | null; limit: number };
    };
    expect(firstBody.entries.map((e) => e.id)).toEqual(['a-5', 'a-4']);
    expect(firstBody.meta.limit).toBe(2);
    expect(firstBody.meta.nextCursor).not.toBeNull();

    const secondReq = await authedRequest(
      `http://localhost/api/audit-log?limit=2&cursor=${encodeURIComponent(firstBody.meta.nextCursor as string)}`,
      userId,
      username,
    );
    const secondRes = await getAuditLog(secondReq, {
      db: handle.db,
      secret: SECRET,
    });
    const secondBody = (await secondRes.json()) as {
      entries: Array<{ id: string }>;
      meta: { nextCursor: string | null };
    };
    expect(secondBody.entries.map((e) => e.id)).toEqual(['a-3', 'a-2']);
    expect(secondBody.meta.nextCursor).not.toBeNull();
  });

  test('search filter does case-insensitive LIKE across before/after JSON', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedAuditLog(handle, [
      {
        id: 'a-1',
        stationId,
        actorUserId: userId,
        action: 'update',
        targetType: 'clock',
        targetId: 'c-1',
        at: '2026-05-01T00:00:00Z',
        afterJson: '{"name":"Drive Time"}',
      },
      {
        id: 'a-2',
        stationId,
        actorUserId: userId,
        action: 'update',
        targetType: 'clock',
        targetId: 'c-2',
        at: '2026-05-02T00:00:00Z',
        afterJson: '{"name":"Late Night"}',
      },
    ]);

    const req = await authedRequest(
      'http://localhost/api/audit-log?search=DRIVE',
      userId,
      username,
    );
    const res = await getAuditLog(req, { db: handle.db, secret: SECRET });
    const body = (await res.json()) as {
      entries: Array<{ id: string }>;
    };
    expect(body.entries.map((e) => e.id)).toEqual(['a-1']);
  });

  test('CSV export sets headers and audits itself', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedAuditLog(handle, [
      {
        id: 'a-1',
        stationId,
        actorUserId: userId,
        action: 'create',
        targetType: 'clock',
        targetId: 'c-1',
        at: '2026-05-01T00:00:00Z',
        afterJson: '{"name":"Drive, Time"}',
      },
    ]);

    const req = await authedRequest(
      'http://localhost/api/audit-log?format=csv',
      userId,
      username,
    );
    const res = await getAuditLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('Content-Disposition')).toMatch(
      /attachment; filename=".*audit-log-.*\.csv"/,
    );
    expect(res.headers.get('X-Row-Count')).toBe('1');
    const text = await res.text();
    expect(text.startsWith('At,Actor,Action,TargetType,TargetId,Before,After'))
      .toBe(true);
    // The after JSON contains a comma → must be RFC4180-quoted.
    expect(text).toContain('"{""name"":""Drive, Time""}"');

    // The export was itself audited.
    const exportRows = handle.mem.public.many(
      "SELECT id, action FROM audit_log WHERE action = 'audit_log_export'",
    ) as Array<{ id: string; action: string }>;
    expect(exportRows.length).toBe(1);
    expect(exportRows[0].action).toBe('audit_log_export');
  });
});

// ===========================================================================
// /api/play-log — GET list / aggregate
// ===========================================================================

describe('GET /api/play-log', () => {
  test('401 when unauthenticated', async () => {
    const { db } = createTestDb();
    const res = await getPlayLog(
      new Request('http://localhost/api/play-log'),
      { db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('list returns entries newest-first, snake→camel mapped', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      {
        id: 'p-1',
        stationId,
        title: 'First',
        artist: 'A',
        playedAt: '2026-05-01T00:00:00Z',
        durationPlayedMs: 60_000,
        source: 'automation',
      },
      {
        id: 'p-2',
        stationId,
        title: 'Second',
        artist: 'B',
        playedAt: '2026-05-02T00:00:00Z',
        durationPlayedMs: 120_000,
        source: 'manual',
      },
    ]);

    const req = await authedRequest(
      'http://localhost/api/play-log',
      userId,
      username,
    );
    const res = await getPlayLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: Array<{
        id: string;
        titleSnapshot: string;
        artistSnapshot: string | null;
        playedAt: string;
        durationPlayedMs: number | null;
        source: string;
      }>;
      meta: { limit: number; nextCursor: string | null };
    };
    expect(body.entries.map((e) => e.id)).toEqual(['p-2', 'p-1']);
    expect(body.entries[0].titleSnapshot).toBe('Second');
    expect(body.entries[0].artistSnapshot).toBe('B');
    expect(body.entries[0].durationPlayedMs).toBe(120_000);
    expect(body.entries[0].source).toBe('manual');
    expect(body.meta.limit).toBe(100);
    expect(body.meta.nextCursor).toBeNull();
  });

  test('list paginates via cursor', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    const rows: PlayLogSeed[] = [];
    for (let i = 1; i <= 4; i += 1) {
      rows.push({
        id: `p-${i}`,
        stationId,
        title: `Track ${i}`,
        playedAt: `2026-05-0${i}T00:00:00Z`,
      });
    }
    seedPlayLog(handle, rows);

    const firstReq = await authedRequest(
      'http://localhost/api/play-log?limit=2',
      userId,
      username,
    );
    const firstRes = await getPlayLog(firstReq, {
      db: handle.db,
      secret: SECRET,
    });
    const firstBody = (await firstRes.json()) as {
      entries: Array<{ id: string }>;
      meta: { nextCursor: string | null };
    };
    expect(firstBody.entries.map((e) => e.id)).toEqual(['p-4', 'p-3']);
    expect(firstBody.meta.nextCursor).not.toBeNull();

    const secondReq = await authedRequest(
      `http://localhost/api/play-log?limit=2&cursor=${encodeURIComponent(firstBody.meta.nextCursor as string)}`,
      userId,
      username,
    );
    const secondRes = await getPlayLog(secondReq, {
      db: handle.db,
      secret: SECRET,
    });
    const secondBody = (await secondRes.json()) as {
      entries: Array<{ id: string }>;
    };
    expect(secondBody.entries.map((e) => e.id)).toEqual(['p-2', 'p-1']);
  });

  test('aggregate=true returns per-track play counts', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      { id: 'p-1', stationId, title: 'Song A', artist: 'X', playedAt: '2026-05-01T00:00:00Z' },
      { id: 'p-2', stationId, title: 'Song A', artist: 'X', playedAt: '2026-05-01T01:00:00Z' },
      { id: 'p-3', stationId, title: 'Song B', artist: 'Y', playedAt: '2026-05-01T02:00:00Z' },
    ]);

    const req = await authedRequest(
      'http://localhost/api/play-log?aggregate=true',
      userId,
      username,
    );
    const res = await getPlayLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      aggregate: Array<{ title: string; artist: string | null; plays: number }>;
      meta: { count: number };
    };
    expect(body.aggregate).toEqual([
      { title: 'Song A', artist: 'X', plays: 2 },
      { title: 'Song B', artist: 'Y', plays: 1 },
    ]);
    expect(body.meta.count).toBe(2);
  });

  test('source filter narrows the list', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    seedPlayLog(handle, [
      {
        id: 'p-1',
        stationId,
        title: 'A',
        playedAt: '2026-05-01T00:00:00Z',
        source: 'automation',
      },
      {
        id: 'p-2',
        stationId,
        title: 'B',
        playedAt: '2026-05-01T01:00:00Z',
        source: 'manual',
      },
    ]);

    const req = await authedRequest(
      'http://localhost/api/play-log?source=manual',
      userId,
      username,
    );
    const res = await getPlayLog(req, { db: handle.db, secret: SECRET });
    const body = (await res.json()) as {
      entries: Array<{ id: string; source: string }>;
    };
    expect(body.entries.map((e) => e.id)).toEqual(['p-2']);
    expect(body.entries[0].source).toBe('manual');
  });
});

// ===========================================================================
// /api/play-log — POST
// ===========================================================================

describe('POST /api/play-log', () => {
  test('401 without session', async () => {
    const { db } = createTestDb();
    const res = await postPlayLog(
      new Request('http://localhost/api/play-log', {
        method: 'POST',
        body: JSON.stringify({ titleSnapshot: 'x', source: 'automation' }),
      }),
      { db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('400 when JSON body is malformed', async () => {
    const { handle, userId, username } = await setupAuthed();
    const req = await authedRequest(
      'http://localhost/api/play-log',
      userId,
      username,
      {
        method: 'POST',
        body: 'not-json{',
      },
    );
    const res = await postPlayLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(400);
  });

  test('400 when source is missing', async () => {
    const { handle, userId, username } = await setupAuthed();
    const req = await authedRequest(
      'http://localhost/api/play-log',
      userId,
      username,
      {
        method: 'POST',
        body: JSON.stringify({ titleSnapshot: 'Song' }),
      },
    );
    const res = await postPlayLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(400);
  });

  test('400 when source is not in the whitelist', async () => {
    const { handle, userId, username } = await setupAuthed();
    const req = await authedRequest(
      'http://localhost/api/play-log',
      userId,
      username,
      {
        method: 'POST',
        body: JSON.stringify({ titleSnapshot: 'Song', source: 'bogus' }),
      },
    );
    const res = await postPlayLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(400);
  });

  test('201 on valid insert; writes play_log + audit_log rows', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    const req = await authedRequest(
      'http://localhost/api/play-log',
      userId,
      username,
      {
        method: 'POST',
        body: JSON.stringify({
          titleSnapshot: 'New Song',
          artistSnapshot: 'New Artist',
          playedAt: '2026-05-05T12:00:00Z',
          durationPlayedMs: 240_000,
          source: 'automation',
        }),
      },
    );
    const res = await postPlayLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      entry: {
        id: string;
        stationId: string;
        titleSnapshot: string;
        artistSnapshot: string | null;
        playedAt: string;
        durationPlayedMs: number | null;
        source: string;
      };
    };
    expect(body.entry.id).toBeTruthy();
    expect(body.entry.stationId).toBe(stationId);
    expect(body.entry.titleSnapshot).toBe('New Song');
    expect(body.entry.artistSnapshot).toBe('New Artist');
    expect(body.entry.playedAt).toBe('2026-05-05T12:00:00Z');
    expect(body.entry.durationPlayedMs).toBe(240_000);
    expect(body.entry.source).toBe('automation');

    // Verify play_log row landed in the DB.
    const inserted = handle.mem.public.many(
      `SELECT id, station_id, title_snapshot, source FROM play_log WHERE id = '${escSql(body.entry.id)}'`,
    ) as Array<{ id: string; station_id: string; title_snapshot: string; source: string }>;
    expect(inserted).toHaveLength(1);
    expect(inserted[0].station_id).toBe(stationId);
    expect(inserted[0].source).toBe('automation');

    // Verify a matching audit_log row was written (best-effort, but tests need to assert it).
    const audit = handle.mem.public.many(
      `SELECT target_id, action FROM audit_log WHERE target_type = 'play_log' AND target_id = '${escSql(body.entry.id)}'`,
    ) as Array<{ target_id: string; action: string }>;
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('create');
  });

  test('stationId always comes from the auth gate, never the body', async () => {
    const { handle, userId, username, stationId } = await setupAuthed();
    const req = await authedRequest(
      'http://localhost/api/play-log',
      userId,
      username,
      {
        method: 'POST',
        body: JSON.stringify({
          // Hostile client supplies a different stationId — must be ignored.
          stationId: 'some-other-station',
          titleSnapshot: 'Secure Song',
          source: 'manual',
        }),
      },
    );
    const res = await postPlayLog(req, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { entry: { stationId: string } };
    expect(body.entry.stationId).toBe(stationId);
    expect(body.entry.stationId).not.toBe('some-other-station');
  });
});
