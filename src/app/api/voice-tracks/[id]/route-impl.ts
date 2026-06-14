/**
 * /api/voice-tracks/:id — get / patch / delete.
 *
 * Mirrors `functions/api/voice-tracks/[id].ts`. The audio bytes still live in
 * object storage; the delete path here invokes a future
 * `src/server/storage.ts` wrapper (Wave RM-γ) when a bucket adapter is wired
 * in. For the dual-stack window we accept either a bucket adapter (tests) or
 * skip the deletion to keep the route bring-up small.
 *
 * All mutations write an `audit_log` row via `writeAuditLog`.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β5.
 */

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { writeAuditLog } from '@/server/audit-log';
import { logAndScrub } from '@/server/internal-error';
import {
  VT_STATUSES,
  deleteVoiceTrack,
  findVoiceTrackById,
  rowToJson,
  updateVoiceTrack,
  type VoiceTrackPatch,
  type VtStatus,
} from '@/server/voice-track-queries';

import type { VoiceTrackBucket } from '../route-impl';

export interface VoiceTrackIdDeps {
  db?: DbClient;
  secret?: string;
  bucket?: VoiceTrackBucket;
}

const voiceTrackPatchSchema = z
  .object({
    transcript: z.string().max(20000).nullable().optional(),
    targetClockSlotId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .nullable()
      .optional(),
    status: z
      .enum(VT_STATUSES as unknown as [VtStatus, ...VtStatus[]])
      .optional(),
    aiGenerated: z.union([z.literal(0), z.literal(1), z.boolean()]).optional(),
  })
  .strict();

function normalizeAi(
  value: 0 | 1 | boolean | undefined,
): 0 | 1 | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

// ---------------------------------------------------------------------------
// GET /api/voice-tracks/:id
// ---------------------------------------------------------------------------

export async function getVoiceTrackHandler(
  request: Request,
  id: string,
  deps: VoiceTrackIdDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  if (!id) return jsonError(404, 'Not found');

  try {
    const row = await findVoiceTrackById(db, gate.context.stationId, id);
    if (!row) return jsonError(404, 'Not found');
    const json = rowToJson(row);
    return jsonOk({
      voiceTrack: {
        ...json,
        streamUrl: `/api/voice-tracks/${encodeURIComponent(id)}/stream`,
      },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'voice-tracks/[id]/get' }));
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/voice-tracks/:id
// ---------------------------------------------------------------------------

export async function patchVoiceTrackHandler(
  request: Request,
  id: string,
  deps: VoiceTrackIdDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  if (!id) return jsonError(404, 'Not found');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = voiceTrackPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const existing = await findVoiceTrackById(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');
  const existingJson = rowToJson(existing);

  const patch: VoiceTrackPatch = {};
  if (parsed.data.transcript !== undefined) {
    patch.transcript = parsed.data.transcript;
  }
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

  try {
    await updateVoiceTrack(db, gate.context.stationId, id, patch);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'voice-tracks/[id]/patch' }));
  }

  const updated = await findVoiceTrackById(db, gate.context.stationId, id);
  if (!updated) return jsonError(404, 'Not found after update');
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

  return jsonOk({ voiceTrack: updatedJson });
}

// ---------------------------------------------------------------------------
// DELETE /api/voice-tracks/:id
// ---------------------------------------------------------------------------

export async function deleteVoiceTrackHandler(
  request: Request,
  id: string,
  deps: VoiceTrackIdDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  if (!id) return jsonError(404, 'Not found');

  const existing = await findVoiceTrackById(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');
  const beforeJson = rowToJson(existing);

  // Pentest L-01: delete the DB row FIRST. If the row delete fails we abort
  // with a 500 and the storage object is left untouched — no dangling DB
  // reference. Only once the row is gone do we best-effort delete the audio
  // bytes; a storage failure there leaves an orphaned object (recoverable via
  // the storageKey preserved in the audit log) rather than a dangling row.
  try {
    await deleteVoiceTrack(db, gate.context.stationId, id);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'voice-tracks/[id]/delete' }));
  }

  if (deps.bucket) {
    try {
      await deps.bucket.delete(existing.storageKey);
    } catch (err) {
      // Best-effort: swallow and log (scrubbed) so a storage hiccup never
      // resurrects the just-deleted row or leaks error internals to ops logs.
      logAndScrub(err, { tag: 'voice-tracks/[id]/delete/storage' });
    }
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'delete',
    targetType: 'voice_track',
    targetId: id,
    before: beforeJson,
  });

  return jsonOk({ ok: true, deleted: beforeJson });
}

// ---------------------------------------------------------------------------
// Next 15 dynamic param signature: ctx.params is a Promise.
// ---------------------------------------------------------------------------

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  const { id } = await ctx.params;
  return getVoiceTrackHandler(request, id);
}

export async function PATCH(
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  const { id } = await ctx.params;
  return patchVoiceTrackHandler(request, id);
}

export async function DELETE(
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  const { id } = await ctx.params;
  return deleteVoiceTrackHandler(request, id);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['GET', 'PATCH', 'DELETE']);
}
