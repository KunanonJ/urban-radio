/**
 * /api/comments/:id — patch + delete.
 *
 * Mirrors `functions/api/comments/[id].ts`. Role gates:
 *   - editing `body` is restricted to the original author;
 *   - resolving/unresolving (`{ resolved: true|false }`) requires the author
 *     or one of {admin, producer};
 *   - deletes require the author or `admin`.
 *
 * Cross-station ids always return 404 — never 403/500 — so we don't leak the
 * existence of foreign rows.
 *
 * All mutations write an `audit_log` row via `writeAuditLog`.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β5.
 */

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
  deleteComment,
  findCommentById,
  rowToJson,
  updateComment,
  type CommentPatch,
} from '@/server/comment-queries';

export interface CommentIdDeps {
  db?: DbClient;
  secret?: string;
  /** Test-only timestamp override (used for both updated_at and resolved_at). */
  now?: () => string;
}

const patchSchema = z
  .object({
    body: z.string().min(1).max(2000).optional(),
    resolved: z.boolean().optional(),
  })
  .strict();

const ROLES_THAT_CAN_RESOLVE = new Set(['admin', 'producer']);
const ROLES_WITH_DELETE_OVERRIDE = new Set(['admin']);

function isAuthor(
  ctx: StationContext,
  row: { authorUserId: string },
): boolean {
  return ctx.userId === row.authorUserId;
}

// ---------------------------------------------------------------------------
// PATCH /api/comments/:id
// ---------------------------------------------------------------------------

export async function patchCommentHandler(
  request: Request,
  id: string,
  deps: CommentIdDeps = {},
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
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }
  if (parsed.data.body === undefined && parsed.data.resolved === undefined) {
    return jsonError(400, 'no fields to update');
  }

  const existing = await findCommentById(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');

  if (parsed.data.body !== undefined && !isAuthor(gate.context, existing)) {
    return jsonError(403, 'Only the author can edit this comment');
  }
  if (parsed.data.resolved !== undefined) {
    const allowed =
      isAuthor(gate.context, existing) ||
      ROLES_THAT_CAN_RESOLVE.has(gate.context.role);
    if (!allowed) {
      return jsonError(403, 'Insufficient role to resolve this comment');
    }
  }

  const now = deps.now?.() ?? new Date().toISOString();

  const patch: CommentPatch = {};
  if (parsed.data.body !== undefined) {
    if (parsed.data.body.trim().length === 0) {
      return jsonError(400, 'body is required');
    }
    patch.body = parsed.data.body;
  }
  if (parsed.data.resolved !== undefined) {
    if (parsed.data.resolved) {
      patch.resolvedAt = now;
      patch.resolvedByUserId = gate.context.userId;
    } else {
      patch.resolvedAt = null;
      patch.resolvedByUserId = null;
    }
  }

  try {
    await updateComment(db, gate.context.stationId, id, patch, { now });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'comments/[id]/patch' }));
  }

  const updated = await findCommentById(db, gate.context.stationId, id);
  if (!updated) return jsonError(404, 'Not found after update');

  const updatedJson = rowToJson(updated);
  const beforeJson = rowToJson(existing);

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'update',
    targetType: 'comment',
    targetId: id,
    before: beforeJson,
    after: updatedJson,
  });

  return jsonOk({ comment: updatedJson });
}

// ---------------------------------------------------------------------------
// DELETE /api/comments/:id
// ---------------------------------------------------------------------------

export async function deleteCommentHandler(
  request: Request,
  id: string,
  deps: CommentIdDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  if (!id) return jsonError(404, 'Not found');

  const existing = await findCommentById(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');

  const canDelete =
    isAuthor(gate.context, existing) ||
    ROLES_WITH_DELETE_OVERRIDE.has(gate.context.role);
  if (!canDelete) {
    return jsonError(403, 'Insufficient role to delete this comment');
  }

  const beforeJson = rowToJson(existing);

  try {
    await deleteComment(db, gate.context.stationId, id);
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'comments/[id]/delete' }));
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'delete',
    targetType: 'comment',
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

export async function PATCH(
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  const { id } = await ctx.params;
  return patchCommentHandler(request, id);
}

export async function DELETE(
  request: Request,
  ctx: RouteContext,
): Promise<Response> {
  const { id } = await ctx.params;
  return deleteCommentHandler(request, id);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['PATCH', 'DELETE']);
}
