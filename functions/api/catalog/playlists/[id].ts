/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../../_lib/env';
import { requireStation } from '../../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request; params: { id: string } };

/**
 * Phase 1 radio schema has no `playlists` table. We always 404 — but only
 * after passing the station-membership gate so the route fails closed for
 * unauthenticated callers (the response code is the same 404, but we don't
 * leak existence information across stations because nothing exists).
 */
export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;

  return Response.json({ error: 'Playlist not found' }, { status: 404 });
}

export const onRequest = onRequestGet;
