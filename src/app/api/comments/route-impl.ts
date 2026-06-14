/**
 * /api/comments — list + create.
 *
 * Mirrors `functions/api/comments/index.ts`. GET supports keyset pagination
 * by `(created_at, id) < (cursor.lastCreatedAt, cursor.lastId)`; POST writes a
 * single row keyed by a server-issued UUID. Both code paths LEFT JOIN
 * `auth_users` so the response includes the author's username in one round
 * trip.
 *
 * All mutations write an `audit_log` row via `writeAuditLog`.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β5.
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { writeAuditLog } from '@/server/audit-log';
import { logAndScrub } from '@/server/internal-error';
import {
  COMMENT_TARGET_TYPES,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimit,
  decodeCursor,
  encodeCursor,
  insertComment,
  isCommentTargetType,
  listComments,
  rowToJson,
  type CommentJson,
  type CommentTargetType,
} from '@/server/comment-queries';

export interface CommentsDeps {
  db?: DbClient;
  secret?: string;
  idGenerator?: () => string;
  now?: () => string;
}

const listQuerySchema = z.object({
  targetType: z.enum(
    COMMENT_TARGET_TYPES as unknown as [
      CommentTargetType,
      ...CommentTargetType[],
    ],
  ),
  targetId: z.string().trim().min(1).max(200),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  includeResolved: z.coerce.boolean().optional(),
});

const createCommentSchema = z.object({
  targetType: z.enum(
    COMMENT_TARGET_TYPES as unknown as [
      CommentTargetType,
      ...CommentTargetType[],
    ],
  ),
  targetId: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(2000),
});

// ---------------------------------------------------------------------------
// GET /api/comments
// ---------------------------------------------------------------------------

export async function listCommentsHandler(
  request: Request,
  deps: CommentsDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  const url = new URL(request.url);
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

  try {
    const rows = await listComments(db, {
      stationId: gate.context.stationId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      includeResolved: parsed.data.includeResolved,
      cursor: cursor ?? undefined,
      limit,
    });
    const commentsJson = rows.map(rowToJson);
    let nextCursor: string | null = null;
    if (rows.length === limit && rows.length > 0) {
      const last = rows[rows.length - 1];
      nextCursor = encodeCursor({
        lastCreatedAt: last.createdAt,
        lastId: last.id,
      });
    }
    return jsonOk({
      comments: commentsJson,
      meta: { nextCursor, limit },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'comments/list' }));
  }
}

// ---------------------------------------------------------------------------
// POST /api/comments
// ---------------------------------------------------------------------------

export async function createCommentHandler(
  request: Request,
  deps: CommentsDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;
  const db = deps.db ?? getDb();

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = createCommentSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  if (!isCommentTargetType(parsed.data.targetType)) {
    return jsonError(400, 'Invalid targetType');
  }
  if (parsed.data.body.trim().length === 0) {
    return jsonError(400, 'body is required');
  }

  const id = deps.idGenerator?.() ?? randomUUID();
  const now = deps.now?.() ?? new Date().toISOString();

  try {
    await insertComment(db, {
      id,
      stationId: gate.context.stationId,
      authorUserId: gate.context.userId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      body: parsed.data.body,
      resolvedAt: null,
      resolvedByUserId: null,
      now,
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'comments/insert' }));
  }

  const persisted: CommentJson = {
    id,
    stationId: gate.context.stationId,
    authorUserId: gate.context.userId,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    body: parsed.data.body.trim(),
    resolvedAt: null,
    resolvedByUserId: null,
    createdAt: now,
    updatedAt: now,
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

  return jsonOk({ comment: persisted }, { status: 201 });
}

// ---------------------------------------------------------------------------
// Method dispatch
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  return listCommentsHandler(request);
}

export async function POST(request: Request): Promise<Response> {
  return createCommentHandler(request);
}

export function OPTIONS(): Response {
  return methodNotAllowed(['GET', 'POST']);
}
