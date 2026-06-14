/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../../_lib/env';
import {
  deriveCatalogId,
  radioTrackToJson,
  type RadioTrackRow,
} from '../../../_lib/catalog-map';
import { buildAlbumDetailQuery } from '../../../_lib/catalog-queries';
import { requireStation } from '../../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request; params: { id: string } };

/**
 * Albums in the Phase 1 radio schema are *derived* from radio_tracks by
 * `GROUP BY album`. The `[id]` param is the slugified album name produced
 * by `deriveCatalogId('album', …)`. To resolve it back to a SQL match we
 * re-derive the slug for every row found via `LIKE ?`, then group.
 *
 * We deliberately reject any cross-station lookups by station_id filter on
 * the SQL itself — there is no information leak about other stations'
 * albums; we always answer 404 if no tracks match for *this* station.
 */
export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const id = ctx.params?.id;
  if (!id) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  // Strip the "album-" prefix; everything else is the slug we need to match.
  const slugBody = id.startsWith('album-') ? id.slice('album-'.length) : id;

  try {
    // Albums are free-text; we have to LIKE-search by slug fragments since
    // we don't have a reverse index. We over-fetch (limit by tracks) then
    // filter in-memory to the row whose slug equals the requested id.
    const { results } = await db
      .prepare(
        `SELECT id, station_id, category_id, title, artist, album, genre, bpm, music_key,
                energy, era_year, language, duration_ms, cue_in_ms, cue_out_ms, intro_ms,
                outro_ms, mix_point_ms, loudness_lufs, file_type, content_hash, storage_key,
                custom_f1, custom_f2, custom_f3, custom_f4, custom_f5, rating, play_count,
                last_played_at, date_added
         FROM radio_tracks
         WHERE station_id = ? AND album IS NOT NULL AND album != ''
         ORDER BY date_added DESC, id DESC
         LIMIT 1000`,
      )
      .bind(gate.context.stationId)
      .all<RadioTrackRow>();

    const matched = (results ?? []).filter(
      (r) =>
        deriveCatalogId('album', r.album) === `album-${slugBody}` ||
        deriveCatalogId('album', r.album) === id,
    );

    if (matched.length === 0) {
      return Response.json({ error: 'Album not found' }, { status: 404 });
    }

    // We have at least one track for this album under this station — build the
    // detail payload via the typed helper, scoped exactly to the album value
    // taken from the first matching row.
    const albumName = matched[0].album ?? '';
    const artistName = matched[0].artist ?? '';
    const detail = buildAlbumDetailQuery({ stationId: gate.context.stationId, albumKey: albumName });
    const { results: trackRows } = await db
      .prepare(detail.sql)
      .bind(...detail.params)
      .all<RadioTrackRow>();
    const tracks = (trackRows ?? []).map((r) => radioTrackToJson(r, ctx.request));

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

    return Response.json({ album, source: 'd1' });
  } catch (err) {
    console.error('catalog/albums/[id]', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
}

export const onRequest = onRequestGet;
