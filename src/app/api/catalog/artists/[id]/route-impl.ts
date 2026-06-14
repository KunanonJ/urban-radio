/**
 * GET /api/catalog/artists/[id] — artist detail page.
 *
 * Mirrors `functions/api/catalog/artists/[id].ts`. Artists are derived
 * from `radio_tracks` via `GROUP BY artist`. The `[id]` param is the
 * slugified artist name; we resolve by enumerating the station's distinct
 * artists and matching slugs client-side, then drill into the canonical
 * detail query.
 *
 * Station scoping is enforced on every query.
 *
 * Private — requires station membership.
 */

import { sql } from 'drizzle-orm';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  deriveCatalogId,
  radioTrackToJson,
  type RadioTrackRow,
} from '@/server/catalog-map';
import { buildArtistDetailQuery } from '@/server/catalog-queries';

interface ArtistDetailDeps {
  db?: DbClient;
  secret?: string;
}

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && 'rows' in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

export async function getCatalogArtistById(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  deps: ArtistDetailDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, deps);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  if (!id) {
    return jsonError(404, 'Not found');
  }

  try {
    const db = deps.db ?? getDb();

    // Enumerate the station's distinct, non-empty artist names. We slug each
    // and pick the one whose derived id matches the requested `[id]` param.
    const candidateQuery = sql`SELECT artist FROM radio_tracks
       WHERE station_id = ${gate.context.stationId}
         AND artist IS NOT NULL
         AND artist != ''
       GROUP BY artist`;
    const candidates = asRows<{ artist: string }>(await db.execute(candidateQuery));
    const match = candidates.find((c) => deriveCatalogId('artist', c.artist) === id);
    if (!match) {
      return jsonError(404, 'Artist not found');
    }

    const detail = buildArtistDetailQuery({
      stationId: gate.context.stationId,
      artistKey: match.artist,
    });
    const trackRows = asRows<RadioTrackRow>(await db.execute(detail.sql));
    const tracks = trackRows.map((r) => radioTrackToJson(r, request));

    // Group into derived albums (id → metadata) deterministically.
    const albumMap = new Map<
      string,
      { title: string; year: number; genre: string; tracks: Record<string, unknown>[] }
    >();
    for (let i = 0; i < trackRows.length; i++) {
      const t = trackRows[i];
      const albumId = deriveCatalogId('album', t.album ?? '');
      const existing =
        albumMap.get(albumId) ?? {
          title: t.album ?? '',
          year: t.era_year ?? 0,
          genre: t.genre ?? '',
          tracks: [],
        };
      existing.tracks.push(tracks[i]);
      if (!existing.year && t.era_year) existing.year = t.era_year;
      if (!existing.genre && t.genre) existing.genre = t.genre;
      albumMap.set(albumId, existing);
    }

    const genresSet = new Set<string>();
    for (const t of trackRows) {
      if (t.genre) genresSet.add(t.genre);
    }

    const albums = Array.from(albumMap.entries()).map(([albumId, info]) => ({
      id: albumId,
      title: info.title,
      artist: match.artist,
      artistId: id,
      artwork: '',
      year: info.year,
      genre: info.genre,
      source: 'cloud',
      trackCount: info.tracks.length,
      tracks: info.tracks,
    }));

    const artist = {
      id,
      name: match.artist,
      artwork: '',
      genres: Array.from(genresSet),
      albumCount: albums.length,
      trackCount: tracks.length,
      tracks,
      albums,
    };

    return jsonOk({ artist, source: 'd1' });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'catalog/artists/[id]/get' }));
  }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return getCatalogArtistById(request, ctx);
}
