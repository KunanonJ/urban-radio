/**
 * Drizzle-side helpers for the station-scoped `/api/comments` endpoints.
 *
 * Mirrors `functions/_lib/comment-queries.ts`, expressed via Drizzle so the
 * Next.js route handlers can run against the Railway Postgres mirror.
 *
 * Validation constants (target type enum, body length, base64-url cursor) are
 * re-implemented locally so the Next routes don't depend on the Cloudflare
 * `functions/` tree. Response shape stays byte-identical with the legacy
 * Cloudflare handlers throughout the dual-stack window.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β5.
 */

import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { type DbClient } from '@/db/client';
import { authUsers, comments } from '@/db/schema';

// ---------------------------------------------------------------------------
// Public constants — match the Cloudflare builder exactly.
// ---------------------------------------------------------------------------

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
export const MAX_BODY_LENGTH = 2000;

export const COMMENT_TARGET_TYPES = [
  'clock',
  'clock_slot',
  'schedule_assignment',
  'voice_track',
  'radio_track',
] as const;

export type CommentTargetType = (typeof COMMENT_TARGET_TYPES)[number];

export function isCommentTargetType(x: unknown): x is CommentTargetType {
  return (
    typeof x === 'string' &&
    (COMMENT_TARGET_TYPES as readonly string[]).includes(x)
  );
}

export interface CommentKeysetCursor {
  lastCreatedAt: string;
  lastId: string;
}

export interface ListCommentsParams {
  stationId: string;
  targetType: CommentTargetType;
  targetId: string;
  includeResolved?: boolean;
  cursor?: CommentKeysetCursor;
  limit: number;
}

export interface CommentPatch {
  body?: string;
  resolvedAt?: string | null;
  resolvedByUserId?: string | null;
}

export interface CommentJson {
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

export function clampLimit(
  value: number | undefined,
  max: number,
  def: number,
): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return def;
  if (value > max) return max;
  return Math.floor(value);
}

function requireValidBody(body: string): void {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error('body is required');
  if (trimmed.length > MAX_BODY_LENGTH) {
    throw new Error(`body must be at most ${MAX_BODY_LENGTH} characters`);
  }
}

// ---------------------------------------------------------------------------
// base64-url cursor encoding (matches Cloudflare cursor exactly).
// ---------------------------------------------------------------------------

function toBase64Url(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64url');
  }
  const b64 = btoa(input);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'base64url').toString('utf8');
  }
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return atob(b64);
}

export function encodeCursor(cursor: CommentKeysetCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

export function decodeCursor(
  input: string | undefined | null,
): CommentKeysetCursor | null {
  if (!input) return null;
  try {
    const json = fromBase64Url(input);
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { lastCreatedAt?: unknown }).lastCreatedAt ===
        'string' &&
      typeof (parsed as { lastId?: unknown }).lastId === 'string'
    ) {
      return parsed as CommentKeysetCursor;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Row → JSON projection (keeps the response shape byte-identical to
// Cloudflare's `rowToJson`).
// ---------------------------------------------------------------------------

interface CommentSelectRow {
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
  authorUsername: string | null;
}

export function rowToJson(row: CommentSelectRow): CommentJson {
  return {
    id: row.id,
    stationId: row.stationId,
    authorUserId: row.authorUserId,
    targetType: row.targetType,
    targetId: row.targetId,
    body: row.body,
    resolvedAt: row.resolvedAt,
    resolvedByUserId: row.resolvedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: {
      userId: row.authorUserId,
      username: row.authorUsername,
    },
  };
}

// ---------------------------------------------------------------------------
// Drizzle query helpers.
// ---------------------------------------------------------------------------

function projection() {
  return {
    id: comments.id,
    stationId: comments.stationId,
    authorUserId: comments.authorUserId,
    targetType: comments.targetType,
    targetId: comments.targetId,
    body: comments.body,
    resolvedAt: comments.resolvedAt,
    resolvedByUserId: comments.resolvedByUserId,
    createdAt: comments.createdAt,
    updatedAt: comments.updatedAt,
    authorUsername: authUsers.username,
  };
}

export async function listComments(
  db: DbClient,
  params: ListCommentsParams,
): Promise<CommentSelectRow[]> {
  if (!params.stationId) throw new Error('stationId is required');
  if (!isCommentTargetType(params.targetType)) {
    throw new Error(
      `target_type must be one of ${COMMENT_TARGET_TYPES.join(', ')}`,
    );
  }
  if (!params.targetId) throw new Error('targetId is required');

  const limit = clampLimit(params.limit, MAX_LIMIT, DEFAULT_LIMIT);

  const conditions = [
    eq(comments.stationId, params.stationId),
    eq(comments.targetType, params.targetType),
    eq(comments.targetId, params.targetId),
  ];
  if (!params.includeResolved) conditions.push(isNull(comments.resolvedAt));
  if (params.cursor) {
    conditions.push(
      or(
        lt(comments.createdAt, params.cursor.lastCreatedAt),
        and(
          eq(comments.createdAt, params.cursor.lastCreatedAt),
          lt(comments.id, params.cursor.lastId),
        ),
      )!,
    );
  }

  return db
    .select(projection())
    .from(comments)
    .leftJoin(authUsers, eq(authUsers.id, comments.authorUserId))
    .where(and(...conditions))
    .orderBy(desc(comments.createdAt), desc(comments.id))
    .limit(limit);
}

export async function findCommentById(
  db: DbClient,
  stationId: string,
  id: string,
): Promise<CommentSelectRow | null> {
  if (!stationId) throw new Error('stationId is required');
  if (!id) throw new Error('id is required');
  const rows = await db
    .select(projection())
    .from(comments)
    .leftJoin(authUsers, eq(authUsers.id, comments.authorUserId))
    .where(and(eq(comments.stationId, stationId), eq(comments.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

export interface CommentInsertParams {
  id: string;
  stationId: string;
  authorUserId: string;
  targetType: CommentTargetType;
  targetId: string;
  body: string;
  resolvedAt?: string | null;
  resolvedByUserId?: string | null;
  /** Optional timestamp override (tests). */
  now?: string;
}

export async function insertComment(
  db: DbClient,
  params: CommentInsertParams,
): Promise<string> {
  if (!params.id) throw new Error('id is required');
  if (!params.stationId) throw new Error('stationId is required');
  if (!params.authorUserId) throw new Error('authorUserId is required');
  if (!isCommentTargetType(params.targetType)) {
    throw new Error(
      `target_type must be one of ${COMMENT_TARGET_TYPES.join(', ')}`,
    );
  }
  if (!params.targetId) throw new Error('targetId is required');
  requireValidBody(params.body);

  const now = params.now ?? new Date().toISOString();
  await db.insert(comments).values({
    id: params.id,
    stationId: params.stationId,
    authorUserId: params.authorUserId,
    targetType: params.targetType,
    targetId: params.targetId,
    body: params.body.trim(),
    resolvedAt: params.resolvedAt ?? null,
    resolvedByUserId: params.resolvedByUserId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return now;
}

export async function updateComment(
  db: DbClient,
  stationId: string,
  id: string,
  patch: CommentPatch,
  opts: { now?: string } = {},
): Promise<void> {
  if (!stationId) throw new Error('stationId is required');
  if (!id) throw new Error('id is required');

  const set: Record<string, unknown> = {};
  let hasField = false;
  if (patch.body !== undefined) {
    requireValidBody(patch.body);
    set.body = patch.body.trim();
    hasField = true;
  }
  if (patch.resolvedAt !== undefined) {
    set.resolvedAt = patch.resolvedAt;
    hasField = true;
  }
  if (patch.resolvedByUserId !== undefined) {
    set.resolvedByUserId = patch.resolvedByUserId;
    hasField = true;
  }
  if (!hasField) throw new Error('no fields to update');

  set.updatedAt = opts.now ?? new Date().toISOString();

  await db
    .update(comments)
    .set(set)
    .where(and(eq(comments.stationId, stationId), eq(comments.id, id)));
}

export async function deleteComment(
  db: DbClient,
  stationId: string,
  id: string,
): Promise<void> {
  if (!stationId) throw new Error('stationId is required');
  if (!id) throw new Error('id is required');
  await db
    .delete(comments)
    .where(and(eq(comments.stationId, stationId), eq(comments.id, id)));
}

// Silence the unused sql tag while keeping the import shape stable for future
// raw helpers (e.g. tuple-comparison cursors when pg supports row literals).
void sql;
