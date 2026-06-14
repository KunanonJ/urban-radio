/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { writeAuditLog } from '../../_lib/audit-log';
import { getStreamControl, type StreamMetadata } from '../../_lib/stream-control';

type Ctx = { env: SonicBloomEnv; request: Request };

const ALLOWED_ROLES = new Set(['admin', 'producer']);

const metadataSchema = z.object({
  title: z.string().trim().min(1, 'title is required').max(500),
  artist: z.string().trim().min(1).max(500).optional(),
  album: z.string().trim().min(1).max(500).optional(),
  artworkUrl: z.string().trim().url().optional(),
});

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Insert the now-playing event into `play_log` so royalty reporting +
 * analytics see every track the Live Studio pushes. This mirrors what
 * AzuraCast's own play log would record — we don't want to lose this
 * data just because we're stubbing the upstream stream engine.
 *
 * `source = 'manual'` because the producer is pushing this metadata
 * by hand from the Live Studio screen (vs `automation` for the clock
 * sequencer or `voice_track` for VT inserts).
 *
 * NEVER throws — a play_log failure must not break the metadata
 * push. We log and swallow.
 */
async function recordNowPlaying(
  db: D1Database,
  stationId: string,
  meta: StreamMetadata,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO play_log
           (id, station_id, track_id, title_snapshot, artist_snapshot, played_at, source)
         VALUES (?, ?, NULL, ?, ?, datetime('now'), 'manual')`,
      )
      .bind(
        crypto.randomUUID(),
        stationId,
        meta.title,
        meta.artist ?? null,
      )
      .run();
  } catch (err) {
    console.error('play_log insert failed', err);
  }
}

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;

  if (!ALLOWED_ROLES.has(gate.context.role)) {
    return jsonError(403, 'Insufficient role for stream control');
  }

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = metadataSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const db = ctx.env.DB!;
  const adapter = getStreamControl(ctx.env as unknown as {
    STREAM_CONTROL_URL?: string;
    STREAM_CONTROL_KEY?: string;
  });

  const meta: StreamMetadata = {
    title: parsed.data.title,
    ...(parsed.data.artist !== undefined && { artist: parsed.data.artist }),
    ...(parsed.data.album !== undefined && { album: parsed.data.album }),
    ...(parsed.data.artworkUrl !== undefined && { artworkUrl: parsed.data.artworkUrl }),
  };

  let result: { ok: true } | { ok: false; error: string };
  try {
    result = await adapter.updateMetadata(gate.context.stationId, meta);
  } catch (err) {
    console.error('stream/metadata adapter', err);
    return jsonError(500, err instanceof Error ? err.message : 'metadata failed');
  }

  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, error: result.error }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // Record now-playing in play_log + write audit_log. Both are best-effort
  // and must not break the metadata push if they fail.
  await recordNowPlaying(db, gate.context.stationId, meta);
  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'stream_metadata',
    targetType: 'station',
    targetId: gate.context.stationId,
    after: meta,
  });

  return Response.json({ ok: true, metadata: meta });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
