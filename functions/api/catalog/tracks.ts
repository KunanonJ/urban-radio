/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { radioTrackToJson, type RadioTrackRow } from '../../_lib/catalog-map';
import {
  buildTracksQuery,
  clampLimit,
  decodeCursor,
  encodeCursor,
  DEFAULT_LIMIT,
  type CatalogFilters,
} from '../../_lib/catalog-queries';
import { requireStation } from '../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

function parseFilters(url: URL): CatalogFilters {
  const filters: CatalogFilters = {};
  const search = url.searchParams.get('search');
  if (search) filters.search = search;
  const category = url.searchParams.get('category');
  if (category) filters.categoryId = category;
  const fileType = url.searchParams.get('fileType');
  if (fileType) filters.fileType = fileType;
  const minBpm = url.searchParams.get('minBpm');
  if (minBpm !== null) {
    const n = Number(minBpm);
    if (Number.isFinite(n)) filters.minBpm = n;
  }
  const maxBpm = url.searchParams.get('maxBpm');
  if (maxBpm !== null) {
    const n = Number(maxBpm);
    if (Number.isFinite(n)) filters.maxBpm = n;
  }
  return filters;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT));
  const cursor = decodeCursor(url.searchParams.get('cursor') ?? undefined);
  const filters = parseFilters(url);

  const { sql, params } = buildTracksQuery({
    stationId: gate.context.stationId,
    cursor: cursor ?? undefined,
    limit,
    filters,
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
    console.error('catalog/tracks', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
}

export const onRequest = onRequestGet;
