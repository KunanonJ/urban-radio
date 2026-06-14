/**
 * GET /api/catalog — aggregate catalog index.
 *
 * Mirrors `functions/api/catalog/index.ts`. Defaults to the first page of
 * tracks for the authenticated user's station. Kept for back-compat with
 * the previous `/api/catalog` shape consumed by the player.
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
} from '@/server/catalog-queries';

interface CatalogIndexDeps {
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

export async function getCatalogIndex(
  request: Request,
  deps: CatalogIndexDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, deps);
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const limit = clampLimit(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT));
  const cursor = decodeCursor(url.searchParams.get('cursor') ?? undefined);

  const { sql: query, effectiveLimit } = buildTracksQuery({
    stationId: gate.context.stationId,
    cursor: cursor ?? undefined,
    limit,
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
    return jsonError(500, logAndScrub(err, { tag: 'catalog/list' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return getCatalogIndex(request);
}
