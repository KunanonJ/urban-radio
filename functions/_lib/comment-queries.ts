/// <reference types="@cloudflare/workers-types" />

/**
 * Pure SQL builders for the station-scoped `/api/comments` endpoints.
 *
 * Comments are anchored to one of five polymorphic targets: clocks,
 * clock_slots, schedule_assignments, voice_tracks, radio_tracks. Every row is
 * scoped by `station_id` so cross-tenant leakage is impossible at the
 * call site — station_id is always the first WHERE predicate.
 *
 * Mirrors voice-track-queries.ts: parametric only, framework-free, returns
 * `{ sql, params }`. Resolved comments are filtered out by default; pass
 * `includeResolved: true` to surface them.
 *
 * The `comments.target_type` column has a CHECK constraint defined in
 * migration 0007. `COMMENT_TARGET_TYPES` mirrors that constraint so the API
 * layer can validate before reaching D1.
 */

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
  return typeof x === 'string' && (COMMENT_TARGET_TYPES as readonly string[]).includes(x);
}

export interface CommentRow {
  id: string;
  stationId: string;
  authorUserId: string;
  targetType: CommentTargetType;
  targetId: string;
  body: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface BuiltQuery {
  sql: string;
  params: unknown[];
}

export function clampLimit(value: number | undefined, max: number, def: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return def;
  if (value > max) return max;
  return Math.floor(value);
}

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

export function decodeCursor(input: string | undefined | null): CommentKeysetCursor | null {
  if (!input) return null;
  try {
    const json = fromBase64Url(input);
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { lastCreatedAt?: unknown }).lastCreatedAt === 'string' &&
      typeof (parsed as { lastId?: unknown }).lastId === 'string'
    ) {
      return parsed as CommentKeysetCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function requireStationId(stationId: string): void {
  if (!stationId) throw new Error('stationId is required');
}

function requireValidBody(body: string): void {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error('body is required');
  if (trimmed.length > MAX_BODY_LENGTH) {
    throw new Error(`body must be at most ${MAX_BODY_LENGTH} characters`);
  }
}

const COMMENT_COLUMNS =
  'id, station_id, author_user_id, target_type, target_id, body, resolved_at, resolved_by_user_id, created_at, updated_at';

export function buildCommentsListQuery(p: ListCommentsParams): BuiltQuery {
  requireStationId(p.stationId);
  if (!isCommentTargetType(p.targetType)) {
    throw new Error(`target_type must be one of ${COMMENT_TARGET_TYPES.join(', ')}`);
  }
  if (!p.targetId) throw new Error('targetId is required');

  const limit = clampLimit(p.limit, MAX_LIMIT, DEFAULT_LIMIT);

  const where: string[] = ['station_id = ?', 'target_type = ?', 'target_id = ?'];
  const params: unknown[] = [p.stationId, p.targetType, p.targetId];

  if (!p.includeResolved) {
    where.push('resolved_at IS NULL');
  }

  if (p.cursor) {
    where.push('(created_at, id) < (?, ?)');
    params.push(p.cursor.lastCreatedAt, p.cursor.lastId);
  }

  const sql = `SELECT ${COMMENT_COLUMNS}
    FROM comments
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}`;

  return { sql, params };
}

export function buildCommentByIdQuery(stationId: string, id: string): BuiltQuery {
  requireStationId(stationId);
  if (!id) throw new Error('id is required');
  const sql = `SELECT ${COMMENT_COLUMNS}
    FROM comments
    WHERE station_id = ? AND id = ?
    LIMIT 1`;
  return { sql, params: [stationId, id] };
}

export function buildCommentInsert(
  row: Omit<CommentRow, 'createdAt' | 'updatedAt'>,
): BuiltQuery {
  if (!row.id) throw new Error('id is required');
  requireStationId(row.stationId);
  if (!row.authorUserId) throw new Error('authorUserId is required');
  if (!isCommentTargetType(row.targetType)) {
    throw new Error(`target_type must be one of ${COMMENT_TARGET_TYPES.join(', ')}`);
  }
  if (!row.targetId) throw new Error('targetId is required');
  requireValidBody(row.body);

  const sql = `INSERT INTO comments
    (id, station_id, author_user_id, target_type, target_id, body, resolved_at, resolved_by_user_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;

  const params: unknown[] = [
    row.id,
    row.stationId,
    row.authorUserId,
    row.targetType,
    row.targetId,
    row.body.trim(),
    row.resolvedAt ?? null,
    row.resolvedByUserId ?? null,
  ];

  return { sql, params };
}

export function buildCommentUpdate(
  stationId: string,
  id: string,
  patch: CommentPatch,
): BuiltQuery {
  requireStationId(stationId);
  if (!id) throw new Error('id is required');

  const sets: string[] = [];
  const params: unknown[] = [];

  if (patch.body !== undefined) {
    requireValidBody(patch.body);
    sets.push('body = ?');
    params.push(patch.body.trim());
  }
  if (patch.resolvedAt !== undefined) {
    sets.push('resolved_at = ?');
    params.push(patch.resolvedAt);
  }
  if (patch.resolvedByUserId !== undefined) {
    sets.push('resolved_by_user_id = ?');
    params.push(patch.resolvedByUserId);
  }

  if (sets.length === 0) throw new Error('no fields to update');

  // Always bump updated_at on every mutation.
  sets.push("updated_at = datetime('now')");

  params.push(stationId, id);

  const sql = `UPDATE comments
    SET ${sets.join(', ')}
    WHERE station_id = ? AND id = ?`;

  return { sql, params };
}

export function buildCommentDelete(stationId: string, id: string): BuiltQuery {
  requireStationId(stationId);
  if (!id) throw new Error('id is required');
  const sql = `DELETE FROM comments WHERE station_id = ? AND id = ?`;
  return { sql, params: [stationId, id] };
}
