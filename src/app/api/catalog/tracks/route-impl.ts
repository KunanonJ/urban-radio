/**
 * GET /api/catalog/tracks — station-scoped tracks list.
 *
 * Mirrors `functions/api/catalog/tracks.ts`. Supports keyset pagination
 * (`cursor`), `limit`, and the same filter set (`search`, `category`,
 * `fileType`, `minBpm`, `maxBpm`) as the legacy handler.
 *
 * Private — requires station membership.
 */

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  radioTrackToJson,
  type RadioTrackRow,
} from '@/server/catalog-map';
import {
  buildTracksQuery,
  clampLimit,
  decodeCursor,
  encodeCursor,
  DEFAULT_LIMIT,
  type CatalogFilters,
} from '@/server/catalog-queries';

interface TracksDeps {
  db?: DbClient;
  secret?: string;
}

function asRows(result: unknown): RadioTrackRow[] {
  if (Array.isArray(result)) return result as RadioTrackRow[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as RadioTrackRow[]) : [];
  }
  return [];
}

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

export async function getCatalogTracks(
  request: Request,
  deps: TracksDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, deps);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT));
  const cursor = decodeCursor(url.searchParams.get('cursor') ?? undefined);
  const filters = parseFilters(url);

  const { sql: query, effectiveLimit } = buildTracksQuery({
    stationId: gate.context.stationId,
    cursor: cursor ?? undefined,
    limit,
    filters,
  });

  try {
    const db = deps.db ?? getDb();
    const result = await db.execute(query);
    const rows = asRows(result);
    const tracks = rows.map((r) => radioTrackToJson(r, request));
    let nextCursor: string | null = null;
    if (rows.length === effectiveLimit && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({ lastDate: last.date_added, lastId: last.id });
    }
    return jsonOk({
      tracks,
      source: 'd1',
      meta: { nextCursor, limit: effectiveLimit },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'catalog/tracks/list' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return getCatalogTracks(request);
}
