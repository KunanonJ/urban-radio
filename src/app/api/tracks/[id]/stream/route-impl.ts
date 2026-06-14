/**
 * GET /api/tracks/:id/stream — audio bytes for a single track.
 *
 * Mirrors `functions/api/tracks/[id]/stream.ts`. Reads `media_r2_key` from
 * the `tracks` table and pipes the corresponding storage object back to
 * the client.
 *
 * Phase β3 NOTE: the Cloudflare deploy reads from an R2 binding directly;
 * the Next port goes through the `StorageAdapter`. Until Wave γ wires up
 * the real S3-compatible adapter, this route returns 503 "Media unavailable"
 * if the storage adapter is in its unconfigured state. Tests pass an
 * in-memory adapter via the `storage` dep.
 *
 * Response shape (matched against Cloudflare byte-for-byte where possible):
 *   200 OK          → audio body + matching Content-Type/Length headers
 *   400 Bad request → track id missing or malformed
 *   401 Unauthorized       → no valid session
 *   403 No station membership
 *   404 No media for track → track row has no `media_r2_key`
 *   404 Object missing     → key exists but storage has no object
 *   500 Error              → DB or storage threw
 *   503 Media unavailable  → DB or storage adapter not configured
 *
 * **Pentest C-02 fix:** the original (Cloudflare) endpoint was protected
 * only by the middleware. The Next.js port now also gates here via
 * `requireStation` — defense in depth. A single misconfigured middleware
 * (see C-01) would otherwise re-expose this route.
 *
 * The legacy `tracks` table is a shared catalog with no `station_id`
 * column, so we don't filter the SELECT by station. But the caller MUST
 * be an authenticated station member.
 */

import { eq } from 'drizzle-orm';

import { getDb, type DbClient } from '@/db/client';
import { tracks } from '@/db/schema';
import { requireStation } from '@/server/auth/require-station';
import {
  getStorage,
  isStorageNotConfigured,
  type StorageAdapter,
} from '@/server/storage';

export interface TrackStreamDeps {
  db?: DbClient;
  storage?: StorageAdapter;
  /** Override JWT secret (tests). Defaults to `process.env.AUTH_JWT_SECRET`. */
  secret?: string;
}

export async function getTrackStream(
  request: Request,
  params: { id: string | string[] | undefined },
  deps: TrackStreamDeps = {},
): Promise<Response> {
  // Resolve DB up-front so we can hand it to requireStation; if the client
  // factory fails we return 503 (storage/DB unavailable).
  let db: DbClient;
  try {
    db = deps.db ?? getDb();
  } catch {
    return new Response('Media unavailable', { status: 503 });
  }

  // Pentest C-02: gate at the handler level. Do not rely on the middleware.
  const gate = await requireStation(request, { db, secret: deps.secret });
  if (!gate.ok) return gate.response;

  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const id = decodeURIComponent(rawId ?? '').trim();
  if (!id) {
    return new Response('Bad request', { status: 400 });
  }

  const storage = deps.storage ?? getStorage();

  let r2Key: string | null = null;
  try {
    const rows = await db
      .select({ mediaR2Key: tracks.mediaR2Key })
      .from(tracks)
      .where(eq(tracks.id, id))
      .limit(1);
    r2Key = rows[0]?.mediaR2Key ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console -- production observability
    console.error('stream', err);
    return new Response('Error', { status: 500 });
  }

  if (!r2Key) {
    return new Response('No media for track', { status: 404 });
  }

  let object: Awaited<ReturnType<StorageAdapter['get']>>;
  try {
    object = await storage.get(r2Key);
  } catch (err) {
    if (isStorageNotConfigured(err)) {
      return new Response('Media unavailable', { status: 503 });
    }
    // eslint-disable-next-line no-console -- production observability
    console.error('stream', err);
    return new Response('Error', { status: 500 });
  }

  if (!object) {
    return new Response('Object missing', { status: 404 });
  }

  const headers = new Headers();
  headers.set('Content-Type', object.contentType || 'application/octet-stream');
  headers.set('Accept-Ranges', 'bytes');
  if (object.size) headers.set('Content-Length', String(object.size));
  headers.set('Cache-Control', 'private, max-age=3600');

  // `object.body` is a Uint8Array — `Response` accepts it at runtime in both
  // node and the edge runtime, but the bundled lib.dom.d.ts types `BodyInit`
  // narrowly. Cast through `BodyInit` after confirming runtime compatibility.
  return new Response(object.body as unknown as BodyInit, {
    status: 200,
    headers,
  });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const params = await ctx.params;
  return getTrackStream(request, { id: params.id });
}
