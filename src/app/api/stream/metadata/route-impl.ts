/**
 * POST /api/stream/metadata — push now-playing metadata to the encoder.
 *
 * Mirrors `functions/api/stream/metadata.ts`. Validates the payload with the
 * same Zod schema as the legacy handler, calls the stream-control adapter,
 * and records the now-playing event into `play_log` (source = 'manual')
 * plus an `audit_log` entry. Both writes are best-effort — a failure must
 * NOT abort the metadata push that already succeeded against the encoder.
 *
 * Response shape (matched byte-for-byte against Cloudflare):
 *   200 OK  → `{ ok: true, metadata: StreamMetadata }`
 *   400     → `{ error: 'Invalid JSON' }`
 *   400     → `{ error: 'Validation failed', details: {...} }`
 *   401     → `{ error: 'Unauthorized' }`
 *   403     → `{ error: 'No station membership' }`
 *   403     → `{ error: 'Insufficient role for stream control' }`
 *   500     → `{ error: <message> }`
 *   502     → `{ ok: false, error: <message> }`
 *   405     → `Method Not Allowed`
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β3.
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { playLog } from '@/db/schema';
import { jsonError, methodNotAllowed } from '@/server/api-response';
import { writeAuditLog } from '@/server/audit-log';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  getStreamControl,
  type StreamControlAdapter,
  type StreamMetadata,
} from '@/server/stream-control';

const ALLOWED_ROLES = new Set(['admin', 'producer']);

const metadataSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(500),
  artist: z.string().trim().min(1).max(500).optional(),
  album: z.string().trim().min(1).max(500).optional(),
  artworkUrl: z.string().trim().url().optional(),
});

export interface StreamMetadataDeps {
  db?: DbClient;
  secret?: string;
  streamControl?: StreamControlAdapter;
  /** Override the play-log id (tests). */
  playLogId?: string;
  /** Override the play-log timestamp (tests). */
  playLogAt?: string;
}

/**
 * Insert a now-playing event into `play_log` (source = 'manual'). NEVER
 * throws — a play_log failure must not break the metadata push. We log
 * and swallow per the contract in the Cloudflare handler.
 */
async function recordNowPlaying(
  db: DbClient,
  stationId: string,
  meta: StreamMetadata,
  opts: { id?: string; at?: string } = {},
): Promise<void> {
  try {
    await db.insert(playLog).values({
      id: opts.id ?? randomUUID(),
      stationId,
      trackId: null,
      titleSnapshot: meta.title,
      artistSnapshot: meta.artist ?? null,
      playedAt: opts.at ?? new Date().toISOString(),
      source: 'manual',
    });
  } catch (err) {
    // eslint-disable-next-line no-console -- intentional: best-effort write
    console.error('play_log insert failed', err);
  }
}

export async function postStreamMetadata(
  request: Request,
  deps: StreamMetadataDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  if (!ALLOWED_ROLES.has(gate.context.role)) {
    return jsonError(403, 'Insufficient role for stream control');
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = metadataSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const adapter =
    deps.streamControl ??
    getStreamControl({
      STREAM_CONTROL_URL: process.env.STREAM_CONTROL_URL,
      STREAM_CONTROL_KEY: process.env.STREAM_CONTROL_KEY,
    });

  const meta: StreamMetadata = {
    title: parsed.data.title,
    ...(parsed.data.artist !== undefined && { artist: parsed.data.artist }),
    ...(parsed.data.album !== undefined && { album: parsed.data.album }),
    ...(parsed.data.artworkUrl !== undefined && {
      artworkUrl: parsed.data.artworkUrl,
    }),
  };

  let result: { ok: true } | { ok: false; error: string };
  try {
    result = await adapter.updateMetadata(gate.context.stationId, meta);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'stream/metadata' }));
  }

  if (!result.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: result.error }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  // Best-effort writes — must NOT fail the metadata push.
  const db = deps.db ?? getDb();
  await recordNowPlaying(db, gate.context.stationId, meta, {
    id: deps.playLogId,
    at: deps.playLogAt,
  });
  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'stream_metadata',
    targetType: 'station',
    targetId: gate.context.stationId,
    after: meta,
  });

  return new Response(JSON.stringify({ ok: true, metadata: meta }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function POST(request: Request): Promise<Response> {
  return postStreamMetadata(request);
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
