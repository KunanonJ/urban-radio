/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { writeAuditLog } from '../../_lib/audit-log';
import {
  buildVoiceTrackByIdQuery,
  buildVoiceTrackDelete,
  buildVoiceTrackUpdate,
  VT_STATUSES,
  type VoiceTrackPatch,
  type VtStatus,
} from '../../_lib/voice-track-queries';

type Ctx = { env: SonicBloomEnv; request: Request; params: { id: string } };

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

async function loadVoiceTrack(
  db: D1Database,
  stationId: string,
  id: string,
): Promise<VoiceTrackDbRow | null> {
  const q = buildVoiceTrackByIdQuery(stationId, id);
  const row = await db
    .prepare(q.sql)
    .bind(...q.params)
    .first<VoiceTrackDbRow>();
  return row ?? null;
}

const voiceTrackPatchSchema = z
  .object({
    transcript: z.string().max(20000).nullable().optional(),
    targetClockSlotId: z.string().trim().min(1).max(120).nullable().optional(),
    status: z.enum(VT_STATUSES as unknown as [VtStatus, ...VtStatus[]]).optional(),
    aiGenerated: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
  })
  .strict();

function normalizeAi(value: 0 | 1 | boolean | undefined): 0 | 1 | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const id = ctx.params?.id;
  if (!id) return jsonError(404, 'Not found');

  try {
    const row = await loadVoiceTrack(db, gate.context.stationId, id);
    if (!row) return jsonError(404, 'Not found');
    const json = rowToJson(row);
    return Response.json({
      voiceTrack: {
        ...json,
        // The audio bytes live in R2; clients fetch via this URL.
        // The actual stream endpoint is out of scope for this wave —
        // we ship the URL shape so the front-end can wire up the player
        // when /api/voice-tracks/:id/stream lands.
        streamUrl: `/api/voice-tracks/${encodeURIComponent(id)}/stream`,
      },
    });
  } catch (err) {
    console.error('voice-tracks/get', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

export async function onRequestPatch(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const id = ctx.params?.id;
  if (!id) return jsonError(404, 'Not found');

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = voiceTrackPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  // Verify the row exists and belongs to this station BEFORE issuing the
  // UPDATE. Without this, a cross-station id leak via 404 vs 500 timing
  // becomes possible.
  const existing = await loadVoiceTrack(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');
  const existingJson = rowToJson(existing);

  const patch: VoiceTrackPatch = {};
  if (parsed.data.transcript !== undefined) patch.transcript = parsed.data.transcript;
  if (parsed.data.targetClockSlotId !== undefined) {
    patch.targetClockSlotId = parsed.data.targetClockSlotId;
  }
  if (parsed.data.status !== undefined) patch.status = parsed.data.status;
  if (parsed.data.aiGenerated !== undefined) {
    patch.aiGenerated = normalizeAi(parsed.data.aiGenerated) as 0 | 1;
  }

  if (
    patch.transcript === undefined &&
    patch.targetClockSlotId === undefined &&
    patch.status === undefined &&
    patch.aiGenerated === undefined
  ) {
    return jsonError(400, 'no fields to update');
  }

  let updateQ: ReturnType<typeof buildVoiceTrackUpdate>;
  try {
    updateQ = buildVoiceTrackUpdate(gate.context.stationId, id, patch);
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid patch');
  }

  try {
    await db.prepare(updateQ.sql).bind(...updateQ.params).run();
  } catch (err) {
    console.error('voice-tracks/patch update', err);
    return jsonError(500, err instanceof Error ? err.message : 'update failed');
  }

  const updated = await loadVoiceTrack(db, gate.context.stationId, id);
  if (!updated) {
    // Extremely defensive — fires only if a concurrent delete raced us.
    return jsonError(404, 'Not found after update');
  }
  const updatedJson = rowToJson(updated);

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'update',
    targetType: 'voice_track',
    targetId: id,
    before: existingJson,
    after: updatedJson,
  });

  return Response.json({ voiceTrack: updatedJson });
}

export async function onRequestDelete(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;
  const bucket = ctx.env.MEDIA_BUCKET;

  const id = ctx.params?.id;
  if (!id) return jsonError(404, 'Not found');

  // Load BEFORE deleting so we record the before-snapshot in audit_log AND
  // know the R2 storage_key to delete.
  const existing = await loadVoiceTrack(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');
  const beforeJson = rowToJson(existing);

  // R2 delete first — but a failure here must not block the DB delete. The
  // user expects the row gone; orphan audio can be swept by a janitor.
  if (bucket) {
    try {
      await bucket.delete(existing.storage_key);
    } catch (err) {
      console.error('voice-tracks/delete r2', err);
    }
  }

  try {
    const del = buildVoiceTrackDelete(gate.context.stationId, id);
    await db.prepare(del.sql).bind(...del.params).run();
  } catch (err) {
    console.error('voice-tracks/delete d1', err);
    return jsonError(500, err instanceof Error ? err.message : 'delete failed');
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'delete',
    targetType: 'voice_track',
    targetId: id,
    before: beforeJson,
  });

  return Response.json({ ok: true, deleted: beforeJson });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  if (ctx.request.method === 'PATCH') return onRequestPatch(ctx);
  if (ctx.request.method === 'DELETE') return onRequestDelete(ctx);
  return jsonError(405, 'Method not allowed');
};
