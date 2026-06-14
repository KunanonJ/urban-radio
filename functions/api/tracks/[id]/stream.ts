/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../../_lib/env';
import { getDb, getR2 } from '../../../_lib/catalog-map';

type Ctx = { env: SonicBloomEnv; request: Request; params: { id: string } };

/**
 * GET /api/tracks/:id/stream — audio bytes from R2 when track has media_r2_key.
 */
export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const id = decodeURIComponent(ctx.params?.id ?? '');
  if (!id) {
    return new Response('Bad request', { status: 400 });
  }

  const db = getDb(env);
  const bucket = getR2(env);
  if (!db || !bucket) {
    return new Response('Media unavailable', { status: 503 });
  }

  try {
    const row = await db
      .prepare(`SELECT media_r2_key FROM tracks WHERE id = ?`)
      .bind(id)
      .first<{ media_r2_key: string | null }>();

    const r2Key = row?.media_r2_key;
    if (!r2Key) {
      return new Response('No media for track', { status: 404 });
    }

    const object = await bucket.get(r2Key);
    if (!object) {
      return new Response('Object missing', { status: 404 });
    }

    const headers = new Headers();
    const type = object.httpMetadata?.contentType ?? 'application/octet-stream';
    headers.set('Content-Type', type);
    headers.set('Accept-Ranges', 'bytes');
    if (object.size) headers.set('Content-Length', String(object.size));
    headers.set('Cache-Control', 'private, max-age=3600');

    return new Response(object.body, { status: 200, headers });
  } catch (e) {
    console.error('stream', e);
    return new Response('Error', { status: 500 });
  }
}
