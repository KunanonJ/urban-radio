/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { writeAuditLog } from '../../_lib/audit-log';
import {
  buildVoiceTrackInsert,
  buildVoiceTracksListQuery,
  clampLimit,
  decodeCursor,
  encodeCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  VT_STATUSES,
  generateStorageKey,
  isAllowedStatus,
  type VtStatus,
} from '../../_lib/voice-track-queries';

type Ctx = { env: SonicBloomEnv; request: Request };

interface VoiceTrackDbRow {
  id: string;
  station_id: string;
  recorded_by: string | null;
  storage_key: string;
  duration_ms: number;
  transcript: string | null;
  target_clock_slot_id: string | null;
  status: string;
  ai_generated: number | null;
  created_at: string;
}

interface VoiceTrackJson {
  id: string;
  stationId: string;
  recordedBy: string | null;
  storageKey: string;
  durationMs: number;
  transcript: string | null;
  targetClockSlotId: string | null;
  status: string;
  aiGenerated: number | null;
  createdAt: string;
}

function rowToJson(row: VoiceTrackDbRow): VoiceTrackJson {
  return {
    id: row.id,
    stationId: row.station_id,
    recordedBy: row.recorded_by,
    storageKey: row.storage_key,
    durationMs: row.duration_ms,
    transcript: row.transcript,
    targetClockSlotId: row.target_clock_slot_id,
    status: row.status,
    aiGenerated: row.ai_generated,
    createdAt: row.created_at,
  };
}

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Shared metadata schema for both multipart `meta` field and JSON-base64 body.
const voiceTrackMetaSchema = z.object({
  durationMs: z.number().int().nonnegative().max(60 * 60 * 1000),
  transcript: z.string().max(20000).optional().nullable(),
  targetClockSlotId: z.string().trim().min(1).max(120).optional().nullable(),
  status: z
    .enum(VT_STATUSES as unknown as [VtStatus, ...VtStatus[]])
    .optional(),
  aiGenerated: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
});

const voiceTrackJsonBodySchema = voiceTrackMetaSchema.extend({
  audioBase64: z.string().min(1, 'audioBase64 is required'),
});

function normalizeAi(value: 0 | 1 | boolean | undefined): 0 | 1 {
  if (value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/**
 * Decode a base64 string into an ArrayBuffer. Works in both Node (Buffer) and
 * Workers (atob fallback) so the same handler runs in vitest and in prod.
 */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    // Buffer's underlying ArrayBuffer may include unrelated bytes; slice to size.
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
  const statusParam = url.searchParams.get('status') ?? undefined;
  if (statusParam !== undefined && !isAllowedStatus(statusParam)) {
    return jsonError(400, `status must be one of ${VT_STATUSES.join(', ')}`);
  }
  const targetClockSlotId = url.searchParams.get('targetClockSlotId') ?? undefined;
  const limit = clampLimit(
    Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT),
    MAX_LIMIT,
    DEFAULT_LIMIT,
  );
  const cursor = decodeCursor(url.searchParams.get('cursor'));

  const { sql, params } = buildVoiceTracksListQuery({
    stationId: gate.context.stationId,
    status: statusParam as VtStatus | undefined,
    targetClockSlotId,
    cursor: cursor ?? undefined,
    limit,
  });

  try {
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<VoiceTrackDbRow>();
    const rows = results ?? [];
    const voiceTracks = rows.map(rowToJson);
    let nextCursor: string | null = null;
    if (rows.length === limit && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({ lastCreatedAt: last.created_at, lastId: last.id });
    }
    return Response.json({
      voiceTracks,
      meta: { nextCursor, limit },
    });
  } catch (err) {
    console.error('voice-tracks/list', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

/**
 * POST /api/voice-tracks
 *
 * Accepts either:
 *   1) multipart/form-data with `file` (audio blob) and `meta` (JSON-encoded
 *      string of `{ durationMs, transcript?, targetClockSlotId?, status?,
 *      aiGenerated? }`).
 *   2) application/json with `{ audioBase64, durationMs, transcript?,
 *      targetClockSlotId?, status?, aiGenerated? }` — used by the AI pipeline
 *      that synthesizes voice audio without ever touching a multipart form.
 *
 * In both cases, the server generates the row id and storage key, ignores any
 * `stationId` in the body, and writes one R2 object + one D1 row + one
 * audit_log row.
 */
export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request, env } = ctx;

  const gate = await requireStation(env, request);
  if (!gate.ok) return gate.response;
  const db = env.DB!;
  const bucket = env.MEDIA_BUCKET;
  if (!bucket) {
    return jsonError(500, 'R2 binding missing');
  }

  const contentType = request.headers.get('content-type') ?? '';
  let audioBytes: ArrayBuffer;
  let meta: z.infer<typeof voiceTrackMetaSchema>;

  if (contentType.includes('multipart/form-data')) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400, 'Invalid multipart body');
    }
    const file = form.get('file');
    if (!(file instanceof Blob) || (file as File).name === undefined && file.size === 0) {
      // Accept either File or Blob; either way, must have bytes.
      if (!(file instanceof Blob)) return jsonError(400, 'Missing audio file');
    }
    if (!(file instanceof Blob)) return jsonError(400, 'Missing audio file');

    try {
      audioBytes = await file.arrayBuffer();
    } catch (e) {
      console.error('voice-tracks read body', e);
      return jsonError(400, 'Failed to read upload body');
    }

    const metaRaw = form.get('meta');
    let parsedMeta: unknown;
    if (typeof metaRaw === 'string' && metaRaw.length > 0) {
      try {
        parsedMeta = JSON.parse(metaRaw);
      } catch {
        return jsonError(400, 'Invalid meta JSON');
      }
    } else {
      parsedMeta = {};
    }
    const validated = voiceTrackMetaSchema.safeParse(parsedMeta);
    if (!validated.success) {
      return jsonError(400, 'Validation failed', validated.error.flatten());
    }
    meta = validated.data;
  } else {
    // JSON-base64 mode
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return jsonError(400, 'Invalid JSON');
    }
    const validated = voiceTrackJsonBodySchema.safeParse(raw);
    if (!validated.success) {
      return jsonError(400, 'Validation failed', validated.error.flatten());
    }
    try {
      audioBytes = base64ToArrayBuffer(validated.data.audioBase64);
    } catch (e) {
      console.error('voice-tracks base64 decode', e);
      return jsonError(400, 'Invalid audioBase64');
    }
    meta = validated.data;
  }

  // Server controls id + storage key. Body never wins.
  const id = crypto.randomUUID();
  const storageKey = generateStorageKey(gate.context.stationId, id);
  const status: VtStatus = meta.status ?? 'draft';
  const aiGenerated = normalizeAi(meta.aiGenerated);

  // 1) R2 write — durable storage of the audio asset.
  try {
    await bucket.put(storageKey, audioBytes, {
      httpMetadata: { contentType: 'audio/mpeg' },
    });
  } catch (err) {
    console.error('voice-tracks r2 put', err);
    return jsonError(500, 'Storage write failed');
  }

  // 2) D1 insert. If this fails we roll back the R2 object so we never leak
  //    orphaned audio for a row that doesn't exist.
  let insert: ReturnType<typeof buildVoiceTrackInsert>;
  try {
    insert = buildVoiceTrackInsert({
      id,
      stationId: gate.context.stationId,
      recordedBy: gate.context.userId,
      storageKey,
      durationMs: meta.durationMs,
      transcript: meta.transcript ?? null,
      targetClockSlotId: meta.targetClockSlotId ?? null,
      status,
      aiGenerated,
    });
  } catch (err) {
    try {
      await bucket.delete(storageKey);
    } catch {
      /* ignore */
    }
    return jsonError(400, err instanceof Error ? err.message : 'Invalid voice track');
  }

  try {
    await db.prepare(insert.sql).bind(...insert.params).run();
  } catch (err) {
    console.error('voice-tracks d1 insert', err);
    try {
      await bucket.delete(storageKey);
    } catch {
      /* ignore */
    }
    return jsonError(500, err instanceof Error ? err.message : 'insert failed');
  }

  const persisted: VoiceTrackJson = {
    id,
    stationId: gate.context.stationId,
    recordedBy: gate.context.userId,
    storageKey,
    durationMs: Math.floor(meta.durationMs),
    transcript: meta.transcript ?? null,
    targetClockSlotId: meta.targetClockSlotId ?? null,
    status,
    aiGenerated,
    // SQL `datetime('now')` writes the canonical createdAt. We mirror the
    // current time so the response is well-formed without round-tripping.
    createdAt: new Date().toISOString(),
  };

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'create',
    targetType: 'voice_track',
    targetId: id,
    after: persisted,
  });

  return new Response(JSON.stringify({ voiceTrack: persisted }), {
    status: 201,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return jsonError(405, 'Method not allowed');
};
