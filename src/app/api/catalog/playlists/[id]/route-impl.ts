/**
 * GET /api/catalog/playlists/[id] — playlist detail (stub).
 *
 * Mirrors `functions/api/catalog/playlists/[id].ts`. Phase 1 radio schema
 * has no `playlists` table — we always 404, but only after passing the
 * station-membership gate so unauthenticated callers see 401 first. No
 * cross-station existence leakage because nothing exists.
 *
 * Private — requires station membership.
 */

import type { DbClient } from '@/db/client';
import { jsonError } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';

interface PlaylistDetailDeps {
  db?: DbClient;
  secret?: string;
}

export async function getCatalogPlaylistById(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  deps: PlaylistDetailDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, deps);
  if (!gate.ok) return gate.response;

  // Touch params to honour the Next 15 signature; never used because the
  // table doesn't exist yet.
  await ctx.params;

  return jsonError(404, 'Playlist not found');
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return getCatalogPlaylistById(request, ctx);
}
