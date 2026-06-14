/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../../_lib/env';
import {
  deriveCatalogId,
  radioTrackToJson,
  type RadioTrackRow,
} from '../../../_lib/catalog-map';
import { buildArtistDetailQuery } from '../../../_lib/catalog-queries';
import { requireStation } from '../../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request; params: { id: string } };

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const id = ctx.params?.id;
  if (!id) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    // Find the canonical artist name by matching slug over the station's tracks.
    const { results: candidates } = await db
      .prepare(
        `SELECT artist FROM radio_tracks
         WHERE station_id = ? AND artist IS NOT NULL AND artist != ''
         GROUP BY artist`,
      )
      .bind(gate.context.stationId)
      .all<{ artist: string }>();
    const match = (candidates ?? []).find((c) => deriveCatalogId('artist', c.artist) === id);
    if (!match) {
      return Response.json({ error: 'Artist not found' }, { status: 404 });
    }

    const detail = buildArtistDetailQuery({
      stationId: gate.context.stationId,
      artistKey: match.artist,
    });
    const { results: rows } = await db
      .prepare(detail.sql)
      .bind(...detail.params)
      .all<RadioTrackRow>();
    const trackRows = rows ?? [];
    const tracks = trackRows.map((r) => radioTrackToJson(r, ctx.request));

    // Group into derived albums (id → album metadata) deterministically.
    const albumMap = new Map<string, { title: string; year: number; genre: string; tracks: typeof tracks }>();
    for (let i = 0; i < trackRows.length; i++) {
      const t = trackRows[i];
      const albumId = deriveCatalogId('album', t.album ?? '');
      const existing = albumMap.get(albumId) ?? {
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

    return Response.json({ artist, source: 'd1' });
  } catch (err) {
    console.error('catalog/artists/[id]', err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'query failed',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  }
}

export const onRequest = onRequestGet;
