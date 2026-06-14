/**
 * GET /api/catalog/albums — derived album list (group-by on radio_tracks).
 *
 * Mirrors `functions/api/catalog/albums.ts`. Albums in the Phase 1 schema
 * are not first-class — they're derived via `GROUP BY album` on
 * `radio_tracks`. Supports `search` and `limit` filters.
 *
 * Private — requires station membership.
 */

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  radioAlbumRowToJson,
  type DerivedAlbumRow,
} from '@/server/catalog-map';
import {
  buildAlbumsQuery,
  clampLimit,
  DEFAULT_LIMIT,
  type CatalogFilters,
} from '@/server/catalog-queries';

interface AlbumsDeps {
  db?: DbClient;
  secret?: string;
}

function asRows(result: unknown): DerivedAlbumRow[] {
  if (Array.isArray(result)) return result as DerivedAlbumRow[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as DerivedAlbumRow[]) : [];
  }
  return [];
}

function parseFilters(url: URL): CatalogFilters {
  const filters: CatalogFilters = {};
  const search = url.searchParams.get('search');
  if (search) filters.search = search;
  return filters;
}

export async function getCatalogAlbums(
  request: Request,
  deps: AlbumsDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, deps);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT));
  const filters = parseFilters(url);

  const { sql: query, effectiveLimit } = buildAlbumsQuery({
    stationId: gate.context.stationId,
    limit,
    filters,
  });

  try {
    const db = deps.db ?? getDb();
    const result = await db.execute(query);
    const rows = asRows(result);
    const albums = rows.map((r) => radioAlbumRowToJson(r));
    return jsonOk({
      albums,
      source: 'd1',
      meta: { nextCursor: null, limit: effectiveLimit },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'catalog/albums/list' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return getCatalogAlbums(request);
}
