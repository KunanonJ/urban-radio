/**
 * GET /api/catalog/artists — derived artist list (group-by on radio_tracks).
 *
 * Mirrors `functions/api/catalog/artists.ts`. Artists are derived via
 * `GROUP BY artist`. Supports `search` and `limit` filters.
 *
 * Private — requires station membership.
 */

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  radioArtistRowToJson,
  type DerivedArtistRow,
} from '@/server/catalog-map';
import {
  buildArtistsQuery,
  clampLimit,
  DEFAULT_LIMIT,
  type CatalogFilters,
} from '@/server/catalog-queries';

interface ArtistsDeps {
  db?: DbClient;
  secret?: string;
}

function asRows(result: unknown): DerivedArtistRow[] {
  if (Array.isArray(result)) return result as DerivedArtistRow[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as DerivedArtistRow[]) : [];
  }
  return [];
}

function parseFilters(url: URL): CatalogFilters {
  const filters: CatalogFilters = {};
  const search = url.searchParams.get('search');
  if (search) filters.search = search;
  return filters;
}

export async function getCatalogArtists(
  request: Request,
  deps: ArtistsDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, deps);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT));
  const filters = parseFilters(url);

  const { sql: query, effectiveLimit } = buildArtistsQuery({
    stationId: gate.context.stationId,
    limit,
    filters,
  });

  try {
    const db = deps.db ?? getDb();
    const result = await db.execute(query);
    const rows = asRows(result);
    const artists = rows.map((r) => radioArtistRowToJson(r));
    return jsonOk({
      artists,
      source: 'd1',
      meta: { nextCursor: null, limit: effectiveLimit },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'catalog/artists/list' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return getCatalogArtists(request);
}
