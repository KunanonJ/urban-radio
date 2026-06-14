/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../_lib/env';
import { getDb, getR2 } from '../_lib/catalog-map';
import { requireStation } from '../_lib/require-station';
import {
  buildDuplicateCheck,
  buildRadioTrackInsert,
  defaultCategoryIdForFileType,
  detectFileType,
  stripExtension,
} from '../_lib/upload-helpers';

const CLOUD_ARTWORK =
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop';

type Ctx = { env: SonicBloomEnv; request: Request };

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'audio.bin';
}

/** Hex-encode an ArrayBuffer. */
function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/** SHA-256 hex digest of the buffer (deterministic; used to dedup uploads). */
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bufToHex(digest);
}

/**
 * POST /api/upload — multipart `file` → R2 + D1 track row (UAT).
 * Without R2 binding, returns dev-shaped JSON only (no persist).
 *
 * Phase 1 changes:
 *   1. Auth gate (requireStation) runs BEFORE any R2/D1 write — no session,
 *      no side effects. The middleware already enforces this for `/api/*`,
 *      but we double-check here so the handler is safe to test in isolation
 *      and resilient against middleware misconfiguration.
 *   2. After the legacy `tracks`/`media_objects` write succeeds, we ALSO
 *      insert into `radio_tracks` scoped to the user's station. Failures on
 *      this best-effort write don't fail the upload — the R2 file and the
 *      legacy row remain durable.
 *   3. Duplicate guard: same `(station_id, content_hash)` returns the
 *      existing radio_tracks row with `deduped: true` instead of inserting.
 */
export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;
  const ct = request.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  // 1) Auth gate. No session ⇒ 401 BEFORE any R2 or D1 side effects.
  //    requireStation also returns 403 for users without station membership.
  const gate = await requireStation(env, request);
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Invalid body' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return Response.json({ error: 'Missing file field' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const safe = safeFileName(file.name);
  const key = `uploads/${id}/${safe}`;
  const db = getDb(env);
  const bucket = getR2(env);

  if (!bucket || !db) {
    return Response.json({
      ok: true,
      id,
      key: `dev/${id}/${safe}`,
      size: file.size,
      warning: 'R2 or D1 not bound — dev fallback only',
    });
  }

  // Buffer the upload once so we can both stream it to R2 and hash it for
  // dedup. Files in Phase 1 are bounded by the platform's request size limit;
  // chunked/streaming hashing can come later if larger uploads land.
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch (e) {
    console.error('upload read', e);
    return Response.json({ error: 'Failed to read upload body' }, { status: 400 });
  }

  const contentHash = await sha256Hex(bytes);

  // 2) Duplicate guard — if the same content already exists for this station,
  //    short-circuit with the existing row. This runs BEFORE the R2 put so we
  //    don't waste storage on identical bytes.
  try {
    const dupQ = buildDuplicateCheck(gate.context.stationId, contentHash);
    const existing = (await db
      .prepare(dupQ.sql)
      .bind(...dupQ.params)
      .first<{ id: string; title: string; storage_key: string }>()) ?? null;
    if (existing) {
      return Response.json({
        ok: true,
        id: existing.id,
        trackId: existing.id,
        key: existing.storage_key,
        size: file.size,
        deduped: true,
      });
    }
  } catch (e) {
    // A duplicate-check failure should not block the upload. We fall through
    // and accept that the row may end up duplicated; the radio_tracks insert
    // below is itself best-effort.
    console.error('radio_tracks dup-check failed', e);
  }

  // 3) R2 write — durable storage of the audio asset.
  try {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
  } catch (e) {
    console.error('r2 put', e);
    return Response.json({ error: 'Storage write failed' }, { status: 500 });
  }

  const title = stripExtension(file.name);
  const trackId = `cloud-${id}`;
  const now = new Date().toISOString();

  // 4) Legacy tracks/media_objects insert — preserved for back-compat with
  //    Phase 0 endpoints and the existing UI surface that still reads them.
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO tracks (id, title, artist_id, album_id, duration, artwork, source, genre, year, track_number, date_added, media_r2_key, content_hash)
         VALUES (?, ?, 'cloud-upload', 'cloud-lib', 0, ?, 'cloud', 'Upload', ?, 1, ?, ?, ?)`,
      ).bind(trackId, title, CLOUD_ARTWORK, new Date().getFullYear(), now, key, contentHash),
      db.prepare(
        `INSERT INTO media_objects (id, r2_key, track_id, bytes, content_type, content_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, key, trackId, file.size, file.type || 'application/octet-stream', contentHash, now),
    ]);
  } catch (e) {
    console.error('d1 insert', e);
    try {
      await bucket.delete(key);
    } catch {
      /* ignore */
    }
    return Response.json({ error: 'Database write failed' }, { status: 500 });
  }

  // 5) Best-effort radio_tracks insert (Phase 1). A failure here is logged
  //    but does NOT fail the upload — R2 + legacy row are already durable.
  try {
    const fileType = detectFileType({ mime: file.type, filename: file.name });
    const categoryId = defaultCategoryIdForFileType(fileType);
    const insert = buildRadioTrackInsert({
      trackId,
      stationId: gate.context.stationId,
      categoryId,
      title,
      storageKey: key,
      contentHash,
      durationMs: 0,
      fileType,
    });
    await db
      .prepare(insert.sql)
      .bind(...insert.params)
      .run();
  } catch (e) {
    console.error('radio_tracks insert failed', e);
  }

  return Response.json({
    ok: true,
    id,
    key,
    size: file.size,
    trackId,
  });
}
