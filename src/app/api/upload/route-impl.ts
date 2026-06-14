/**
 * POST /api/upload — multipart `file` → storage + DB rows.
 *
 * Mirrors `functions/api/upload.ts`. The Cloudflare deployment uses R2; the
 * Next port goes through `StorageAdapter` (Wave γ swaps in the real S3 wrapper).
 *
 * Pipeline (each step is auditable in tests via the deps argument):
 *   1. Require a station session (401 / 403 short-circuits).
 *   2. Parse the multipart body — only the `file` field is honoured.
 *   3. Buffer + SHA-256 hash the bytes for dedup.
 *   4. Duplicate check against (station_id, content_hash) on `radio_tracks`.
 *      Hit → 200 with `deduped: true` and the existing row's id.
 *   5. `storage.put(...)` — durable bytes BEFORE any DB write.
 *   6. Insert into legacy `tracks` + `media_objects` (back-compat with
 *      existing catalog UI). A failure here triggers a compensating
 *      `storage.delete(...)` and 500.
 *   7. Best-effort insert into `radio_tracks` (Phase 1 row scoped to the
 *      caller's station). A failure here is logged and swallowed — R2
 *      and legacy row are already durable.
 *
 * Response shape (matched against Cloudflare):
 *   200 → `{ ok: true, id, key, size, trackId }`         (success)
 *   200 → `{ ok: true, id, trackId, key, size, deduped: true }` (dup hit)
 *   200 → `{ ok: true, id, key, size, warning: ... }`    (storage unavailable)
 *   400 → `{ error: 'Expected multipart/form-data' }`
 *   400 → `{ error: 'Invalid body' }`
 *   400 → `{ error: 'Missing file field' }`
 *   400 → `{ error: 'Failed to read upload body' }`
 *   401 → `{ error: 'Unauthorized' }`
 *   403 → `{ error: 'No station membership' }`
 *   500 → `{ error: 'Storage write failed' }`
 *   500 → `{ error: 'Database write failed' }`
 *   405 → Method Not Allowed
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β3.
 */

import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import { getDb, type DbClient } from '@/db/client';
import { mediaObjects, radioTracks, tracks } from '@/db/schema';
import { jsonError, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import {
  getStorage,
  isStorageNotConfigured,
  type StorageAdapter,
} from '@/server/storage';
import {
  ALLOWED_AUDIO_TYPES,
  defaultCategoryIdForFileType,
  detectFileType,
  isAllowedAudioType,
  MAX_UPLOAD_BYTES,
  safeFileName,
  sha256Hex,
  sniffAudioMagicBytes,
  stripExtension,
} from '@/server/upload-helpers';

const CLOUD_ARTWORK =
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&h=300&fit=crop';

export interface UploadDeps {
  db?: DbClient;
  secret?: string;
  storage?: StorageAdapter;
  /** Override the generated upload id (tests). */
  generateId?: () => string;
}

export async function postUpload(
  request: Request,
  deps: UploadDeps = {},
): Promise<Response> {
  // 0. Quick content-type guard — the Cloudflare version emits this BEFORE
  //    the auth gate so we keep parity.
  const ct = request.headers.get('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) {
    return jsonError(400, 'Expected multipart/form-data');
  }

  // H-03: Reject oversized requests early using Content-Length header.
  const contentLengthRaw = request.headers.get('content-length');
  if (contentLengthRaw !== null) {
    const contentLength = parseInt(contentLengthRaw, 10);
    if (!Number.isNaN(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Upload too large', maxBytes: MAX_UPLOAD_BYTES }),
        {
          status: 413,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }
  }

  // 1. Auth gate. No session ⇒ 401 BEFORE any storage or DB side effects.
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, 'Invalid body');
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return jsonError(400, 'Missing file field');
  }

  const id = deps.generateId ? deps.generateId() : randomUUID();
  const safe = safeFileName(file.name);
  const key = `uploads/${id}/${safe}`;

  // 2. Resolve DB + storage. If either is missing/unconfigured, emit the
  //    dev-fallback response that the Cloudflare handler uses when the R2
  //    binding is absent.
  let db: DbClient | null = null;
  try {
    db = deps.db ?? getDb();
  } catch {
    db = null;
  }
  const storage = deps.storage ?? getStorage();

  // Probe the storage adapter cheaply: a try/catch put would corrupt state.
  // Instead, we attempt the real flow and treat a "not configured" failure
  // as the dev fallback. This matches Cloudflare's behaviour when bindings
  // are missing.
  if (!db) {
    return new Response(
      JSON.stringify({
        ok: true,
        id,
        key: `dev/${id}/${safe}`,
        size: file.size,
        warning: 'R2 or D1 not bound — dev fallback only',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  // H-04: MIME allowlist check against the declared Content-Type.
  if (!isAllowedAudioType(file.type)) {
    return new Response(
      JSON.stringify({
        error: 'Audio MIME type not allowed',
        contentType: file.type,
        allowed: Array.from(ALLOWED_AUDIO_TYPES),
      }),
      {
        status: 415,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  // 3. Buffer the upload + SHA-256 hash for dedup. Files are bounded by the
  //    platform's request size limit; chunked/streaming hashing can come
  //    later if larger uploads land.
  let bytes: Uint8Array;
  try {
    const buf = await file.arrayBuffer();
    bytes = new Uint8Array(buf);
  } catch (err) {
    // eslint-disable-next-line no-console -- production observability
    console.error('upload read', err);
    return jsonError(400, 'Failed to read upload body');
  }

  // H-03: Post-parse size check (catches cases where Content-Length was absent or wrong).
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return new Response(
      JSON.stringify({ error: 'Upload too large', maxBytes: MAX_UPLOAD_BYTES }),
      {
        status: 413,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  // H-04: Magic-byte sniffing — validate that file content is actually audio.
  const sniffedType = sniffAudioMagicBytes(bytes);
  if (sniffedType === null) {
    return new Response(
      JSON.stringify({ error: 'File content is not a recognized audio format' }),
      {
        status: 415,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  const contentHash = await sha256Hex(bytes);

  // 4. Duplicate guard. Runs BEFORE the storage put so we don't waste bytes
  //    on identical content.
  try {
    const existingRows = await db
      .select({
        id: radioTracks.id,
        title: radioTracks.title,
        storageKey: radioTracks.storageKey,
      })
      .from(radioTracks)
      .where(
        and(
          eq(radioTracks.stationId, gate.context.stationId),
          eq(radioTracks.contentHash, contentHash),
        ),
      )
      .limit(1);
    const existing = existingRows[0];
    if (existing) {
      // Pentest M-08: do NOT return `existing.storageKey` — internal R2
      // key is a server-side detail and exposes the namespace.
      return new Response(
        JSON.stringify({
          ok: true,
          id: existing.id,
          trackId: existing.id,
          size: file.size,
          deduped: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }
  } catch (err) {
    // A duplicate-check failure should not block the upload. We fall through
    // and accept the row may end up duplicated; the radio_tracks insert
    // below is itself best-effort.
    // eslint-disable-next-line no-console -- production observability
    console.error('radio_tracks dup-check failed', err);
  }

  // 5. Storage write. Unconfigured adapter ⇒ dev fallback response.
  try {
    await storage.put(
      key,
      bytes,
      file.type || 'application/octet-stream',
    );
  } catch (err) {
    if (isStorageNotConfigured(err)) {
      return new Response(
        JSON.stringify({
          ok: true,
          id,
          key: `dev/${id}/${safe}`,
          size: file.size,
          warning: 'R2 or D1 not bound — dev fallback only',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }
    // eslint-disable-next-line no-console -- production observability
    console.error('storage put', err);
    return jsonError(500, 'Storage write failed');
  }

  const title = stripExtension(file.name);
  const trackId = `cloud-${id}`;
  const now = new Date().toISOString();

  // 6. Legacy `tracks` + `media_objects` insert — preserved for back-compat
  //    with the existing UI surface. A failure here compensates the storage
  //    put before returning 500.
  try {
    await db.insert(tracks).values({
      id: trackId,
      title,
      artistId: 'cloud-upload',
      albumId: 'cloud-lib',
      duration: 0,
      artwork: CLOUD_ARTWORK,
      source: 'cloud',
      genre: 'Upload',
      year: new Date().getFullYear(),
      trackNumber: 1,
      dateAdded: now,
      mediaR2Key: key,
      contentHash,
    });
    await db.insert(mediaObjects).values({
      id,
      r2Key: key,
      trackId,
      bytes: file.size,
      contentType: file.type || 'application/octet-stream',
      contentHash,
      createdAt: now,
    });
  } catch (err) {
    // eslint-disable-next-line no-console -- production observability
    console.error('db insert', err);
    try {
      await storage.delete(key);
    } catch {
      /* ignore */
    }
    return jsonError(500, 'Database write failed');
  }

  // 7. Best-effort radio_tracks insert (Phase 1). A failure here is logged
  //    but does NOT fail the upload — storage + legacy rows are durable.
  try {
    const fileType = detectFileType({ mime: file.type, filename: file.name });
    const categoryId = defaultCategoryIdForFileType(fileType);
    await db.insert(radioTracks).values({
      id: trackId,
      stationId: gate.context.stationId,
      categoryId,
      title,
      storageKey: key,
      contentHash,
      durationMs: 0,
      fileType,
      dateAdded: now,
    });
  } catch (err) {
    // eslint-disable-next-line no-console -- production observability
    console.error('radio_tracks insert failed', err);
  }

  // Pentest M-08: do NOT include `key` (storage path) in the response. The
  // client already has `id` and `trackId`; audio is fetched via the
  // /api/tracks/[id]/stream endpoint which resolves the key server-side.
  return new Response(
    JSON.stringify({
      ok: true,
      id,
      size: file.size,
      trackId,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  return postUpload(request);
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
