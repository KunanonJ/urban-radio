/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { radioArtistRowToJson, type DerivedArtistRow } from '../../_lib/catalog-map';
import {
  buildArtistsQuery,
  clampLimit,
  DEFAULT_LIMIT,
  type CatalogFilters,
} from '../../_lib/catalog-queries';
import { requireStation } from '../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

function parseFilters(url: URL): CatalogFilters {
  const filters: CatalogFilters = {};
  const search = url.searchParams.get('search');
  if (search) filters.search = search;
  return filters;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT));
  const filters = parseFilters(url);

  const { sql, params } = buildArtistsQuery({
    stationId: gate.context.stationId,
    limit,
    filters,
  });

  try {
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<DerivedArtistRow>();
    const artists = (results ?? []).map((r) => radioArtistRowToJson(r));
    return Response.json({
      artists,
      source: 'd1',
      meta: { nextCursor: null, limit },
    });
  } catch (err) {
    console.error('catalog/artists', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
}

export const onRequest = onRequestGet;
