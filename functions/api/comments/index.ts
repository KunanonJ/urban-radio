/// <reference types="@cloudflare/workers-types" />

/**
 * /api/comments
 *
 *   GET  /api/comments?targetType=&targetId=&cursor=&limit=&includeResolved=
 *        Returns the comment thread for a given object. JOINs `auth_users` so
 *        the response includes the author's username for each row.
 *
 *   POST /api/comments
 *        Creates a new comment. Server controls id, station_id, and
 *        author_user_id from the session. Body must be 1..2000 chars after
 *        trim. Writes an audit_log row with action='create',
 *        target_type='comment'.
 */

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { writeAuditLog } from '../../_lib/audit-log';
import {
  buildCommentInsert,
  buildCommentsListQuery,
  clampLimit,
  COMMENT_TARGET_TYPES,
  decodeCursor,
  encodeCursor,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  isCommentTargetType,
  type CommentTargetType,
} from '../../_lib/comment-queries';

type Ctx = { env: SonicBloomEnv; request: Request };

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
  author_username: string | null;
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

function rowToJson(row: CommentDbRow): CommentJson {
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
      username: row.author_username,
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

const listQuerySchema = z.object({
  targetType: z.enum(COMMENT_TARGET_TYPES as unknown as [CommentTargetType, ...CommentTargetType[]]),
  targetId: z.string().trim().min(1).max(200),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  includeResolved: z.coerce.boolean().optional(),
});

const createCommentSchema = z.object({
  targetType: z.enum(COMMENT_TARGET_TYPES as unknown as [CommentTargetType, ...CommentTargetType[]]),
  targetId: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(2000),
});

/**
 * Rewrite the comments SELECT to include a LEFT JOIN against auth_users so
 * we can surface the author's username in one round-trip.
 *
 * The base SQL from `buildCommentsListQuery` uses `FROM comments WHERE …`. We
 * splice a `LEFT JOIN auth_users` after the table reference, and prefix the
 * SELECT columns with the comments table alias so the JOIN doesn't collide.
 */
function joinAuthorUsername(sql: string): string {
  // Add the `c.` alias to comment columns to disambiguate from the join.
  // Replace the leading `SELECT … FROM comments` with `SELECT c.…, u.username AS author_username FROM comments c LEFT JOIN auth_users u ON u.id = c.author_user_id`.
  return sql
    .replace(/SELECT[\s\S]+?FROM comments/m, (block) => {
      const columnsMatch = block.match(/SELECT\s+([\s\S]+?)\s+FROM comments/);
      if (!columnsMatch) return block;
      const aliased = columnsMatch[1]
        .split(',')
        .map((c) => `c.${c.trim()}`)
        .join(', ');
      return `SELECT ${aliased}, u.username AS author_username FROM comments c LEFT JOIN auth_users u ON u.id = c.author_user_id`;
    })
    .replace(/\bstation_id\b/g, 'c.station_id')
    .replace(/\btarget_type\b/g, 'c.target_type')
    .replace(/\btarget_id\b/g, 'c.target_id')
    .replace(/\bresolved_at IS NULL\b/g, 'c.resolved_at IS NULL')
    .replace(/\bORDER BY created_at DESC, id DESC\b/g, 'ORDER BY c.created_at DESC, c.id DESC')
    .replace(/\(created_at, id\) < \(\?, \?\)/g, '(c.created_at, c.id) < (?, ?)');
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
  const parsed = listQuerySchema.safeParse({
    targetType: url.searchParams.get('targetType') ?? undefined,
    targetId: url.searchParams.get('targetId') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    includeResolved: url.searchParams.get('includeResolved') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, 'Invalid query parameters', parsed.error.flatten());
  }

  const limit = clampLimit(parsed.data.limit, MAX_LIMIT, DEFAULT_LIMIT);
  const cursor = decodeCursor(parsed.data.cursor ?? null);

  let baseQ: ReturnType<typeof buildCommentsListQuery>;
  try {
    baseQ = buildCommentsListQuery({
      stationId: gate.context.stationId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      includeResolved: parsed.data.includeResolved,
      cursor: cursor ?? undefined,
      limit,
    });
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid query');
  }

  const sql = joinAuthorUsername(baseQ.sql);

  try {
    const { results } = await db
      .prepare(sql)
      .bind(...baseQ.params)
      .all<CommentDbRow>();
    const rows = results ?? [];
    const comments = rows.map(rowToJson);
    let nextCursor: string | null = null;
    if (rows.length === limit && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({ lastCreatedAt: last.created_at, lastId: last.id });
    }
    return Response.json({
      comments,
      meta: { nextCursor, limit },
    });
  } catch (err) {
    console.error('comments/list', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = createCommentSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  // Belt + suspenders: target type must come from the canonical list.
  if (!isCommentTargetType(parsed.data.targetType)) {
    return jsonError(400, 'Invalid targetType');
  }

  // Reject blank-after-trim bodies before we hit the SQL builder.
  if (parsed.data.body.trim().length === 0) {
    return jsonError(400, 'body is required');
  }

  const id = crypto.randomUUID();
  let insert: ReturnType<typeof buildCommentInsert>;
  try {
    insert = buildCommentInsert({
      id,
      stationId: gate.context.stationId,
      authorUserId: gate.context.userId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      body: parsed.data.body,
      resolvedAt: null,
      resolvedByUserId: null,
    });
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid comment');
  }

  try {
    await db
      .prepare(insert.sql)
      .bind(...insert.params)
      .run();
  } catch (err) {
    console.error('comments/insert', err);
    return jsonError(500, err instanceof Error ? err.message : 'insert failed');
  }

  const nowIso = new Date().toISOString();
  const persisted: CommentJson = {
    id,
    stationId: gate.context.stationId,
    authorUserId: gate.context.userId,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    body: parsed.data.body.trim(),
    resolvedAt: null,
    resolvedByUserId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
    author: {
      userId: gate.context.userId,
      username: gate.context.username ?? null,
    },
  };

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'create',
    targetType: 'comment',
    targetId: id,
    after: persisted,
  });

  return new Response(JSON.stringify({ comment: persisted }), {
    status: 201,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return jsonError(405, 'Method not allowed');
};
