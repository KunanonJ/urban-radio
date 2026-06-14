/**
 * GET  /api/play-log — keyset-paginated list with optional aggregate flavour.
 * POST /api/play-log — log a single play row (writes audit_log too).
 *
 * Mirrors `functions/api/play-log/index.ts`. station_id is sourced from the
 * authenticated gate and never from the request body — this prevents
 * cross-station log injection regardless of what the client sends.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { writeAuditLog } from '@/server/audit-log';
import { logAndScrub } from '@/server/internal-error';
import {
  ALLOWED_SOURCES,
  clampLimit,
  decodeCursor,
  DEFAULT_LIMIT,
  encodeCursor,
  insertPlayLog,
  MAX_LIMIT,
  queryPlayLogAggregate,
  queryPlayLogList,
  type PlayLogSource,
} from '@/server/queries/play-log-queries';

interface PlayLogDeps {
  db?: DbClient;
  secret?: string;
}

const playLogPostSchema = z.object({
  trackId: z.string().trim().min(1).max(120).optional(),
  titleSnapshot: z
    .string()
    .trim()
    .min(1, 'titleSnapshot is required')
    .max(500),
  artistSnapshot: z.string().trim().max(500).optional(),
  playedAt: z.string().trim().min(1).optional(),
  durationPlayedMs: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 60 * 60 * 1000)
    .optional(),
  source: z.enum(
    ALLOWED_SOURCES as unknown as [PlayLogSource, ...PlayLogSource[]],
  ),
  isrc: z.string().trim().max(32).optional(),
  iswc: z.string().trim().max(32).optional(),
});

export async function getPlayLog(
  request: Request,
  deps: PlayLogDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  const url = new URL(request.url);
  const aggregate = url.searchParams.get('aggregate') === 'true';
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;

  if (aggregate) {
    try {
      const aggregateRows = await queryPlayLogAggregate(db, {
        stationId: gate.context.stationId,
        from,
        to,
      });
      return jsonOk({
        aggregate: aggregateRows.map((r) => ({
          title: r.title,
          artist: r.artist,
          plays: r.plays,
        })),
        meta: { count: aggregateRows.length },
      });
    } catch (err) {
      return jsonError(500, logAndScrub(err, { tag: 'play-log/aggregate' }));
    }
  }

  const limit = clampLimit(
    Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT),
    MAX_LIMIT,
    DEFAULT_LIMIT,
  );
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const source = url.searchParams.get('source') ?? undefined;
  const trackId = url.searchParams.get('trackId') ?? undefined;

  try {
    const rows = await queryPlayLogList(db, {
      stationId: gate.context.stationId,
      from,
      to,
      source,
      trackId,
      cursor: cursor ?? undefined,
      limit,
    });
    const entries = rows.map((row) => ({
      id: row.id,
      stationId: row.stationId,
      trackId: row.trackId,
      titleSnapshot: row.titleSnapshot,
      artistSnapshot: row.artistSnapshot,
      playedAt: row.playedAt,
      durationPlayedMs: row.durationPlayedMs,
      source: row.source,
      isrc: row.isrc,
      iswc: row.iswc,
    }));
    let nextCursor: string | null = null;
    if (rows.length === limit && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({
        lastPlayedAt: last.playedAt,
        lastId: last.id,
      });
    }
    return jsonOk({
      entries,
      meta: { nextCursor, limit },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'play-log/list' }));
  }
}

export async function postPlayLog(
  request: Request,
  deps: PlayLogDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = playLogPostSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const id = randomUUID();
  let row;
  try {
    row = await insertPlayLog(db, {
      id,
      // CRITICAL: stationId comes from the authenticated gate, never from
      // the request body. Prevents cross-station log injection regardless
      // of what the client sends.
      stationId: gate.context.stationId,
      trackId: parsed.data.trackId,
      titleSnapshot: parsed.data.titleSnapshot,
      artistSnapshot: parsed.data.artistSnapshot,
      playedAt: parsed.data.playedAt,
      durationPlayedMs: parsed.data.durationPlayedMs,
      source: parsed.data.source,
      isrc: parsed.data.isrc,
      iswc: parsed.data.iswc,
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'play-log/insert' }));
  }

  // Best-effort audit row. Never throws.
  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'create',
    targetType: 'play_log',
    targetId: id,
    after: {
      trackId: parsed.data.trackId ?? null,
      titleSnapshot: parsed.data.titleSnapshot,
      artistSnapshot: parsed.data.artistSnapshot ?? null,
      playedAt: parsed.data.playedAt ?? null,
      source: parsed.data.source,
    },
  });

  return new Response(
    JSON.stringify({
      entry: {
        id: row.id,
        stationId: row.stationId,
        trackId: row.trackId,
        titleSnapshot: row.titleSnapshot,
        artistSnapshot: row.artistSnapshot,
        // For parity with the Cloudflare handler — which echoes back the body
        // value (`playedAt ?? null`) rather than the materialised row's
        // played_at — we preserve nullability here.
        playedAt: parsed.data.playedAt ?? null,
        durationPlayedMs: row.durationPlayedMs,
        source: row.source,
        isrc: row.isrc,
        iswc: row.iswc,
      },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  );
}

export async function GET(request: Request): Promise<Response> {
  return getPlayLog(request);
}

export async function POST(request: Request): Promise<Response> {
  return postPlayLog(request);
}

export async function PUT(): Promise<Response> {
  return methodNotAllowed(['GET', 'POST']);
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed(['GET', 'POST']);
}
