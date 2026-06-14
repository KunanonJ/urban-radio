/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { radioTrackToJson, type RadioTrackRow } from '../../_lib/catalog-map';
import {
  buildTracksQuery,
  clampLimit,
  decodeCursor,
  encodeCursor,
  DEFAULT_LIMIT,
} from '../../_lib/catalog-queries';
import { requireStation } from '../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

/**
 * Aggregate catalog index — defaults to the first page of tracks for the
 * authenticated user's station. Kept for back-compat with the previous
 * `/api/catalog` shape used by the player.
 */
export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT));
  const cursor = decodeCursor(url.searchParams.get('cursor') ?? undefined);

  const { sql, params } = buildTracksQuery({
    stationId: gate.context.stationId,
    cursor: cursor ?? undefined,
    limit,
  });

  try {
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<RadioTrackRow>();
    const rows = results ?? [];
    const tracks = rows.map((r) => radioTrackToJson(r, ctx.request));
    let nextCursor: string | null = null;
    if (rows.length === limit && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({ lastDate: last.date_added, lastId: last.id });
    }
    return Response.json({
      tracks,
      source: 'd1',
      meta: { nextCursor, limit },
    });
  } catch (err) {
    console.error('catalog/index', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
}

export const onRequest = onRequestGet;
