/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import {
  ALLOWED_SOURCES,
  buildPlayLogAggregateQuery,
  buildPlayLogInsert,
  buildPlayLogListQuery,
  clampLimit,
  decodeCursor,
  encodeCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type PlayLogSource,
} from '../../_lib/play-log-queries';

type Ctx = { env: SonicBloomEnv; request: Request };

interface PlayLogRow {
  id: string;
  station_id: string;
  track_id: string | null;
  title_snapshot: string;
  artist_snapshot: string | null;
  played_at: string;
  duration_played_ms: number | null;
  source: string;
  isrc: string | null;
  iswc: string | null;
}

interface AggregateRow {
  title_snapshot: string;
  artist_snapshot: string | null;
  plays: number;
}

function playLogRowToJson(row: PlayLogRow): Record<string, unknown> {
  return {
    id: row.id,
    stationId: row.station_id,
    trackId: row.track_id,
    titleSnapshot: row.title_snapshot,
    artistSnapshot: row.artist_snapshot,
    playedAt: row.played_at,
    durationPlayedMs: row.duration_played_ms,
    source: row.source,
    isrc: row.isrc,
    iswc: row.iswc,
  };
}

function aggregateRowToJson(row: AggregateRow): Record<string, unknown> {
  return {
    title: row.title_snapshot,
    artist: row.artist_snapshot,
    plays: row.plays,
  };
}

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const playLogPostSchema = z.object({
  trackId: z.string().trim().min(1).max(120).optional(),
  titleSnapshot: z.string().trim().min(1, 'titleSnapshot is required').max(500),
  artistSnapshot: z.string().trim().max(500).optional(),
  playedAt: z.string().trim().min(1).optional(),
  durationPlayedMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000).optional(),
  source: z.enum(ALLOWED_SOURCES as unknown as [PlayLogSource, ...PlayLogSource[]]),
  isrc: z.string().trim().max(32).optional(),
  iswc: z.string().trim().max(32).optional(),
});

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
  const aggregate = url.searchParams.get('aggregate') === 'true';
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;

  if (aggregate) {
    try {
      const { sql, params } = buildPlayLogAggregateQuery({
        stationId: gate.context.stationId,
        from,
        to,
      });
      const { results } = await db
        .prepare(sql)
        .bind(...params)
        .all<AggregateRow>();
      const aggregateRows = (results ?? []).map(aggregateRowToJson);
      return Response.json({
        aggregate: aggregateRows,
        meta: { count: aggregateRows.length },
      });
    } catch (err) {
      console.error('play-log/aggregate', err);
      return jsonError(500, err instanceof Error ? err.message : 'query failed');
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

  const { sql, params } = buildPlayLogListQuery({
    stationId: gate.context.stationId,
    from,
    to,
    source,
    trackId,
    cursor: cursor ?? undefined,
    limit,
  });

  try {
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<PlayLogRow>();
    const rows = results ?? [];
    const entries = rows.map(playLogRowToJson);
    let nextCursor: string | null = null;
    if (rows.length === limit && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({ lastPlayedAt: last.played_at, lastId: last.id });
    }
    return Response.json({
      entries,
      meta: { nextCursor, limit },
    });
  } catch (err) {
    console.error('play-log/list', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = playLogPostSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const id = crypto.randomUUID();
  // CRITICAL: stationId is taken from the authenticated gate, never the body.
  // This prevents cross-station log injection regardless of what the client sends.
  const insert = buildPlayLogInsert({
    id,
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

  try {
    await db
      .prepare(insert.sql)
      .bind(...insert.params)
      .run();
  } catch (err) {
    console.error('play-log/insert', err);
    return jsonError(500, err instanceof Error ? err.message : 'insert failed');
  }

  return new Response(
    JSON.stringify({
      entry: {
        id,
        stationId: gate.context.stationId,
        trackId: parsed.data.trackId ?? null,
        titleSnapshot: parsed.data.titleSnapshot,
        artistSnapshot: parsed.data.artistSnapshot ?? null,
        playedAt: parsed.data.playedAt ?? null,
        durationPlayedMs: parsed.data.durationPlayedMs ?? null,
        source: parsed.data.source,
        isrc: parsed.data.isrc ?? null,
        iswc: parsed.data.iswc ?? null,
      },
    }),
    {
      status: 201,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  );
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
