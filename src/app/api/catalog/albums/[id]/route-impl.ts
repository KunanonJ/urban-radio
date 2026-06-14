/**
 * GET /api/catalog/albums/[id] — album detail page.
 *
 * Mirrors `functions/api/catalog/albums/[id].ts`. Albums in the Phase 1
 * radio schema are derived from `radio_tracks` via `GROUP BY album`. The
 * `[id]` param is the slugified album name produced by `deriveCatalogId`.
 * To resolve it back to a SQL match, we over-fetch the station's
 * non-empty-album tracks and re-derive the slug client-side, then drill
 * into the canonical detail query using the matched album name.
 *
 * Station scoping is enforced on every query — there is no information
 * leak about other stations' albums.
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
import { buildAlbumDetailQuery } from '@/server/catalog-queries';

interface AlbumDetailDeps {
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

export async function getCatalogAlbumById(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
  deps: AlbumDetailDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, deps);
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  if (!id) {
    return jsonError(404, 'Not found');
  }

  const slugBody = id.startsWith('album-') ? id.slice('album-'.length) : id;

  try {
    const db = deps.db ?? getDb();

    // Over-fetch station-scoped non-empty-album tracks; we filter by the
    // derived slug below. Same upper bound as the Cloudflare path.
    const candidateQuery = sql`SELECT id, station_id, category_id, title, artist, album, genre, bpm, music_key,
              energy, era_year, language, duration_ms, cue_in_ms, cue_out_ms, intro_ms,
              outro_ms, mix_point_ms, loudness_lufs, file_type, content_hash, storage_key,
              custom_f1, custom_f2, custom_f3, custom_f4, custom_f5, rating, play_count,
              last_played_at, date_added
       FROM radio_tracks
       WHERE station_id = ${gate.context.stationId}
         AND album IS NOT NULL
         AND album != ''
       ORDER BY date_added DESC, id DESC
       LIMIT 1000`;

    const candidates = asRows<RadioTrackRow>(await db.execute(candidateQuery));
    const matched = candidates.filter(
      (r) =>
        deriveCatalogId('album', r.album) === `album-${slugBody}` ||
        deriveCatalogId('album', r.album) === id,
    );

    if (matched.length === 0) {
      return jsonError(404, 'Album not found');
    }

    const albumName = matched[0].album ?? '';
    const artistName = matched[0].artist ?? '';
    const detail = buildAlbumDetailQuery({
      stationId: gate.context.stationId,
      albumKey: albumName,
    });
    const trackRows = asRows<RadioTrackRow>(await db.execute(detail.sql));
    const tracks = trackRows.map((r) => radioTrackToJson(r, request));

    const album = {
      id,
      title: albumName,
      artist: artistName,
      artistId: deriveCatalogId('artist', artistName),
      artwork: '',
      year: matched[0].era_year ?? 0,
      genre: matched[0].genre ?? '',
      source: 'cloud',
      trackCount: tracks.length,
      dateAdded: matched[0].date_added,
      tracks,
    };

    return jsonOk({ album, source: 'd1' });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'catalog/albums/[id]/get' }));
  }
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  return getCatalogAlbumById(request, ctx);
}
