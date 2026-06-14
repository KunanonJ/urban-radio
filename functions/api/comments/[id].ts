/// <reference types="@cloudflare/workers-types" />

/**
 * /api/comments/:id
 *
 *   PATCH  – Body edits are restricted to the original author.
 *            Resolve / unresolve via `{ resolved: true|false }` requires
 *            role ∈ {admin, producer}. Anything else returns 403.
 *
 *   DELETE – Author or admin only.
 *
 * Both operations write an audit_log row (action='update' or 'delete',
 * target_type='comment'). Cross-station ids return 404 — never 403/500 —
 * to avoid leaking the existence of foreign rows.
 */

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation, type StationContext } from '../../_lib/require-station';
import { writeAuditLog } from '../../_lib/audit-log';
import {
  buildCommentByIdQuery,
  buildCommentDelete,
  buildCommentUpdate,
  type CommentPatch,
} from '../../_lib/comment-queries';

type Ctx = { env: SonicBloomEnv; request: Request; params: { id: string } };

interface CommentDbRow {
  id: string;
  station_id: string;
  author_user_id: string;
  target_type: string;
  target_id: string;
  body: string;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CommentJson {
  id: string;
  stationId: string;
  authorUserId: string;
  targetType: string;
  targetId: string;
  body: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  author: {
    userId: string;
    username: string | null;
  };
}

function rowToJson(row: CommentDbRow, authorUsername?: string | null): CommentJson {
  return {
    id: row.id,
    stationId: row.station_id,
    authorUserId: row.author_user_id,
    targetType: row.target_type,
    targetId: row.target_id,
    body: row.body,
    resolvedAt: row.resolved_at,
    resolvedByUserId: row.resolved_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: {
      userId: row.author_user_id,
      username: authorUsername ?? null,
    },
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

async function loadComment(
  db: D1Database,
  stationId: string,
  id: string,
): Promise<CommentDbRow | null> {
  const q = buildCommentByIdQuery(stationId, id);
  const row = await db
    .prepare(q.sql)
    .bind(...q.params)
    .first<CommentDbRow>();
  return row ?? null;
}

const patchSchema = z
  .object({
    body: z.string().min(1).max(2000).optional(),
    resolved: z.boolean().optional(),
  })
  .strict();

const ROLES_THAT_CAN_RESOLVE = new Set(['admin', 'producer']);
const ROLES_WITH_DELETE_OVERRIDE = new Set(['admin']);

function isAuthor(ctx: StationContext, row: CommentDbRow): boolean {
  return ctx.userId === row.author_user_id;
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
  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }
  if (parsed.data.body === undefined && parsed.data.resolved === undefined) {
    return jsonError(400, 'no fields to update');
  }

  const existing = await loadComment(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');

  // Role gates:
  // - editing body: only the original author.
  // - resolve/unresolve: author OR roles ∈ {admin, producer}.
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

  const patch: CommentPatch = {};
  if (parsed.data.body !== undefined) {
    if (parsed.data.body.trim().length === 0) {
      return jsonError(400, 'body is required');
    }
    patch.body = parsed.data.body;
  }
  if (parsed.data.resolved !== undefined) {
    if (parsed.data.resolved) {
      patch.resolvedAt = new Date().toISOString();
      patch.resolvedByUserId = gate.context.userId;
    } else {
      patch.resolvedAt = null;
      patch.resolvedByUserId = null;
    }
  }

  let updateQ: ReturnType<typeof buildCommentUpdate>;
  try {
    updateQ = buildCommentUpdate(gate.context.stationId, id, patch);
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid patch');
  }

  try {
    await db.prepare(updateQ.sql).bind(...updateQ.params).run();
  } catch (err) {
    console.error('comments/patch update', err);
    return jsonError(500, err instanceof Error ? err.message : 'update failed');
  }

  const updated = await loadComment(db, gate.context.stationId, id);
  if (!updated) return jsonError(404, 'Not found after update');

  const updatedJson = rowToJson(updated, gate.context.username ?? null);
  const beforeJson = rowToJson(existing, gate.context.username ?? null);

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'update',
    targetType: 'comment',
    targetId: id,
    before: beforeJson,
    after: updatedJson,
  });

  return Response.json({ comment: updatedJson });
}

export async function onRequestDelete(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const id = ctx.params?.id;
  if (!id) return jsonError(404, 'Not found');

  const existing = await loadComment(db, gate.context.stationId, id);
  if (!existing) return jsonError(404, 'Not found');

  const canDelete =
    isAuthor(gate.context, existing) ||
    ROLES_WITH_DELETE_OVERRIDE.has(gate.context.role);
  if (!canDelete) {
    return jsonError(403, 'Insufficient role to delete this comment');
  }

  const beforeJson = rowToJson(existing, gate.context.username ?? null);

  try {
    const del = buildCommentDelete(gate.context.stationId, id);
    await db.prepare(del.sql).bind(...del.params).run();
  } catch (err) {
    console.error('comments/delete', err);
    return jsonError(500, err instanceof Error ? err.message : 'delete failed');
  }

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'delete',
    targetType: 'comment',
    targetId: id,
    before: beforeJson,
  });

  return Response.json({ ok: true, deleted: beforeJson });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'PATCH') return onRequestPatch(ctx);
  if (ctx.request.method === 'DELETE') return onRequestDelete(ctx);
  return jsonError(405, 'Method not allowed');
};
