/**
 * GET /api/catalog/playlists — station-scoped playlist list (stub).
 *
 * Mirrors `functions/api/catalog/playlists.ts`. Phase 1 radio schema does
 * not have a `playlists` table; we still enforce station membership so
 * unauthenticated / cross-station callers fail closed. List is always empty
 * — the endpoint stays here so the API surface stays stable for the UI
 * while playlists are reintroduced in a later phase.
 *
 * Private — requires station membership.
 */

import type { DbClient } from '@/db/client';
import { jsonOk } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { clampLimit, DEFAULT_LIMIT } from '@/server/catalog-queries';

interface PlaylistsDeps {
  db?: DbClient;
  secret?: string;
}

export async function getCatalogPlaylists(
  request: Request,
  deps: PlaylistsDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, deps);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT));

  return jsonOk({
    playlists: [],
    source: 'd1',
    meta: { nextCursor: null, limit },
  });
}

export async function GET(request: Request): Promise<Response> {
  return getCatalogPlaylists(request);
}
