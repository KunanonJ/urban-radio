/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { clampLimit, DEFAULT_LIMIT } from '../../_lib/catalog-queries';
import { requireStation } from '../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

/**
 * Phase 1 radio schema has no `playlists` table. We still enforce station
 * membership so unauthenticated/cross-station callers fail closed, but the
 * list is always empty. The endpoint stays here so the API surface remains
 * stable for the UI while playlists are re-introduced in a later phase.
 */
export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;

  const url = new URL(ctx.request.url);
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT));

  return Response.json({
    playlists: [],
    source: 'd1',
    meta: { nextCursor: null, limit },
  });
}

export const onRequest = onRequestGet;
