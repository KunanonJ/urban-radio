/**
 * /api/voice-tracks — list + create.
 *
 * Mirrors `functions/api/voice-tracks/index.ts`. The audio bytes still land
 * in object storage; the upload path here writes through a future
 * `src/server/storage.ts` wrapper (Wave RM-γ). For the dual-stack window we
 * accept the upload but skip the R2 write to keep the route bring-up small.
 * Tests inject an optional `bucket` stub via deps so the persistence path is
 * still exercisable end-to-end.
 *
 * All mutations write an `audit_log` row via `writeAuditLog`.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β5.
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import {
  requireStation,
  type StationContext,
} from '@/server/auth/require-station';
import { writeAuditLog } from '@/server/audit-log';
import { logAndScrub } from '@/server/internal-error';
import {
  ALLOWED_AUDIO_TYPES,
  isAllowedAudioType,
  MAX_UPLOAD_BYTES,
  MAX_VOICE_TRACK_BASE64_CHARS,
  sniffAudioMagicBytes,
} from '@/server/upload-helpers';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  VT_STATUSES,
  clampLimit,
  decodeCursor,
  encodeCursor,
  generateStorageKey,
  insertVoiceTrack,
  isAllowedStatus,
  listVoiceTracks,
  rowToJson,
  type VoiceTrackJson,
  type VtStatus,
} from '@/server/voice-track-queries';

// ---------------------------------------------------------------------------
// Audio bucket abstraction. Production wires in the S3/R2 adapter from
// Wave RM-γ; tests inject a stub so the persistence path stays unit-testable.
// ---------------------------------------------------------------------------

export interface VoiceTrackBucket {
  put(
    key: string,
    data: ArrayBuffer,
    opts?: { contentType?: string },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface VoiceTracksDeps {
  db?: DbClient;
  /** Optional auth override (delegated to `requireStation`). */
  secret?: string;
  /** Optional bucket adapter. When undefined, R2/S3 writes are skipped. */
  bucket?: VoiceTrackBucket;
  /** Test-only id generator override. */
  idGenerator?: () => string;
  /** Test-only timestamp override. */
  now?: () => string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

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
  audioBase64: z
    .string()
    .min(1, 'audioBase64 is required')
    .max(
      MAX_VOICE_TRACK_BASE64_CHARS,
      `audioBase64 exceeds maximum allowed size (${MAX_VOICE_TRACK_BASE64_CHARS} chars)`,
    ),
});

function normalizeAi(value: 0 | 1 | boolean | undefined): 0 | 1 {
  if (value === undefined) return 0;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer;
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

// ---------------------------------------------------------------------------
// GET /api/voice-tracks
// ---------------------------------------------------------------------------

export async function listVoiceTracksHandler(
  request: Request,
  deps: VoiceTracksDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status') ?? undefined;
  if (statusParam !== undefined && !isAllowedStatus(statusParam)) {
    return jsonError(400, `status must be one of ${VT_STATUSES.join(', ')}`);
  }
  const targetClockSlotId =
    url.searchParams.get('targetClockSlotId') ?? undefined;
  const limit = clampLimit(
    Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT),
    MAX_LIMIT,
    DEFAULT_LIMIT,
  );
  const cursor = decodeCursor(url.searchParams.get('cursor'));

  try {
    const rows = await listVoiceTracks(db, {
      stationId: gate.context.stationId,
      status: statusParam as VtStatus | undefined,
      targetClockSlotId,
      cursor: cursor ?? undefined,
      limit,
    });
    const voiceTracksJson = rows.map(rowToJson);
    let nextCursor: string | null = null;
    if (rows.length === limit && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({
        lastCreatedAt: last.createdAt,
        lastId: last.id,
      });
    }
    return jsonOk({
      voiceTracks: voiceTracksJson,
      meta: { nextCursor, limit },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'voice-tracks/list' }));
  }
}

// ---------------------------------------------------------------------------
// POST /api/voice-tracks
// ---------------------------------------------------------------------------

interface ParsedVoiceTrackUpload {
  meta: z.infer<typeof voiceTrackMetaSchema>;
  audioBytes: ArrayBuffer;
}

async function parseUpload(
  request: Request,
): Promise<ParsedVoiceTrackUpload | Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
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

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return jsonError(400, 'Invalid multipart body');
    }
    const file = form.get('file');
    if (!(file instanceof Blob)) return jsonError(400, 'Missing audio file');

    // H-04: MIME allowlist check.
    const declaredType = file instanceof File ? file.type : '';
    if (!isAllowedAudioType(declaredType)) {
      return new Response(
        JSON.stringify({
          error: 'Audio MIME type not allowed',
          contentType: declaredType,
          allowed: Array.from(ALLOWED_AUDIO_TYPES),
        }),
        {
          status: 415,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }

    let audioBytes: ArrayBuffer;
    try {
      audioBytes = await file.arrayBuffer();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('voice-tracks read body', err);
      return jsonError(400, 'Failed to read upload body');
    }

    // H-03: Post-parse size check.
    if (audioBytes.byteLength > MAX_UPLOAD_BYTES) {
      return new Response(
        JSON.stringify({ error: 'Upload too large', maxBytes: MAX_UPLOAD_BYTES }),
        {
          status: 413,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }

    // H-04: Magic-byte sniffing.
    const sniffedType = sniffAudioMagicBytes(new Uint8Array(audioBytes));
    if (sniffedType === null) {
      return new Response(
        JSON.stringify({ error: 'File content is not a recognized audio format' }),
        {
          status: 415,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }

    const metaRaw = form.get('meta');
    let parsedMeta: unknown = {};
    if (typeof metaRaw === 'string' && metaRaw.length > 0) {
      try {
        parsedMeta = JSON.parse(metaRaw);
      } catch {
        return jsonError(400, 'Invalid meta JSON');
      }
    }
    const validated = voiceTrackMetaSchema.safeParse(parsedMeta);
    if (!validated.success) {
      return jsonError(400, 'Validation failed', validated.error.flatten());
    }
    return { meta: validated.data, audioBytes };
  }

  // JSON-base64 mode.
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
  let audioBytes: ArrayBuffer;
  try {
    audioBytes = base64ToArrayBuffer(validated.data.audioBase64);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('voice-tracks base64 decode', err);
    return jsonError(400, 'Invalid audioBase64');
  }

  // H-04: MIME check on the decoded base64 bytes using magic-byte sniffing.
  const sniffedBase64Type = sniffAudioMagicBytes(new Uint8Array(audioBytes));
  if (sniffedBase64Type === null) {
    return new Response(
      JSON.stringify({ error: 'File content is not a recognized audio format' }),
      {
        status: 415,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  return { meta: validated.data, audioBytes };
}

export async function createVoiceTrackHandler(
  request: Request,
  deps: VoiceTracksDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();
  const context: StationContext = gate.context;

  const parsedUpload = await parseUpload(request);
  if (parsedUpload instanceof Response) return parsedUpload;
  const { meta, audioBytes } = parsedUpload;

  const id = deps.idGenerator?.() ?? randomUUID();
  const storageKey = generateStorageKey(context.stationId, id);
  const status: VtStatus = meta.status ?? 'draft';
  const aiGenerated = normalizeAi(meta.aiGenerated);
  const createdAt = deps.now?.() ?? new Date().toISOString();

  if (deps.bucket) {
    try {
      await deps.bucket.put(storageKey, audioBytes, {
        contentType: 'audio/mpeg',
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('voice-tracks bucket put', err);
      return jsonError(500, 'Storage write failed');
    }
  }

  try {
    await insertVoiceTrack(db, {
      id,
      stationId: context.stationId,
      recordedBy: context.userId,
      storageKey,
      durationMs: meta.durationMs,
      transcript: meta.transcript ?? null,
      targetClockSlotId: meta.targetClockSlotId ?? null,
      status,
      aiGenerated,
      createdAt,
    });
  } catch (err) {
    if (deps.bucket) {
      try {
        await deps.bucket.delete(storageKey);
      } catch {
        /* ignore — janitor will sweep orphans */
      }
    }
    // Validation-style errors from the helper (missing fields, bad status)
    // should surface as 400 instead of 500.
    const rawMessage = err instanceof Error ? err.message : 'insert failed';
    if (
      /required|must be one of|must be a non-negative number/i.test(rawMessage)
    ) {
      // eslint-disable-next-line no-console -- intentional: server-side observability
      console.error('[voice-tracks/insert]', err);
      return jsonError(400, rawMessage);
    }
    return jsonError(500, logAndScrub(err, { tag: 'voice-tracks/insert' }));
  }

  // Pentest M-08: omit `storageKey` from the JSON we return to the client.
  // The audit-log payload below still records the storageKey internally —
  // ops need it for forensic operations — but it never reaches the
  // browser.
  const persisted: VoiceTrackJson = {
    id,
    stationId: context.stationId,
    recordedBy: context.userId,
    durationMs: Math.floor(meta.durationMs),
    transcript: meta.transcript ?? null,
    targetClockSlotId: meta.targetClockSlotId ?? null,
    status,
    aiGenerated,
    createdAt,
  };

  await writeAuditLog(db, {
    stationId: context.stationId,
    actorUserId: context.userId,
    action: 'create',
    targetType: 'voice_track',
    targetId: id,
    after: persisted,
  });

  return jsonOk({ voiceTrack: persisted }, { status: 201 });
}

// ---------------------------------------------------------------------------
// Method dispatch
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  return listVoiceTracksHandler(request);
}

export async function POST(request: Request): Promise<Response> {
  return createVoiceTrackHandler(request);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['GET', 'POST']);
}
