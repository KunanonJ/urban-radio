/**
 * TanStack Query hooks for the comments feature (Phase 6).
 *
 * Backend lives at `/api/comments` (GET + POST) and `/api/comments/:id`
 * (PATCH + DELETE). See `functions/api/comments/index.ts` and
 * `functions/api/comments/[id].ts`.
 *
 * The list endpoint is cursor-paginated; we expose it via `useInfiniteQuery`.
 * Mutations all invalidate the `['comments', targetType, targetId, …]` keys
 * so any mounted `CommentThread` for that target refetches.
 *
 * Note: this is the *client-side* query module. It is separate from the
 * server-side SQL builder at `functions/_lib/comment-queries.ts`.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-base';

export const COMMENT_TARGET_TYPES = [
  'clock',
  'clock_slot',
  'schedule_assignment',
  'voice_track',
  'radio_track',
] as const;

export type CommentTargetType = (typeof COMMENT_TARGET_TYPES)[number];

export interface CommentAuthor {
  userId: string;
  username: string | null;
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
  author: CommentAuthor;
}

export interface CommentTarget {
  type: CommentTargetType;
  id: string;
}

export interface CommentListOptions {
  includeResolved?: boolean;
}

export interface CommentPage {
  comments: CommentRow[];
  meta: { nextCursor: string | null; limit: number };
}

interface CommentJsonResponse {
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
  author: { userId: string; username: string | null };
}

interface CommentsListResponse {
  comments: CommentJsonResponse[];
  meta: { nextCursor: string | null; limit: number };
}

interface CommentEnvelope {
  comment: CommentJsonResponse;
}

function isCommentTargetType(value: string): value is CommentTargetType {
  return (COMMENT_TARGET_TYPES as readonly string[]).includes(value);
}

function normalizeRow(raw: CommentJsonResponse): CommentRow {
  const targetType: CommentTargetType = isCommentTargetType(raw.targetType)
    ? raw.targetType
    : 'clock';
  return {
    id: raw.id,
    stationId: raw.stationId,
    authorUserId: raw.authorUserId,
    targetType,
    targetId: raw.targetId,
    body: raw.body,
    resolvedAt: raw.resolvedAt,
    resolvedByUserId: raw.resolvedByUserId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    author: raw.author,
  };
}

async function readJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === 'string') detail = body.error;
    } catch {
      /* swallow — fall through to status text */
    }
    throw new Error(detail ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

const DEFAULT_LIMIT = 50;

const QK = {
  root: ['comments'] as const,
  thread: (target: CommentTarget, opts: CommentListOptions) =>
    ['comments', target.type, target.id, opts] as const,
};

export function buildCommentsUrl(
  target: CommentTarget,
  opts: CommentListOptions,
  cursor: string | null,
  limit: number,
): string {
  const params = new URLSearchParams();
  params.set('targetType', target.type);
  params.set('targetId', target.id);
  if (opts.includeResolved) params.set('includeResolved', 'true');
  if (cursor) params.set('cursor', cursor);
  params.set('limit', String(limit));
  return `/api/comments?${params.toString()}`;
}

export async function fetchCommentsPage(
  target: CommentTarget,
  opts: CommentListOptions,
  cursor: string | null,
  limit: number,
): Promise<CommentPage> {
  const res = await apiFetch(buildCommentsUrl(target, opts, cursor, limit));
  const body = await readJsonOrThrow<CommentsListResponse>(res);
  return {
    comments: (body.comments ?? []).map(normalizeRow),
    meta: {
      nextCursor: body.meta?.nextCursor ?? null,
      limit: body.meta?.limit ?? limit,
    },
  };
}

export interface CreateCommentInput {
  targetType: CommentTargetType;
  targetId: string;
  body: string;
}

export async function postCreateComment(
  input: CreateCommentInput,
): Promise<{ comment: CommentRow }> {
  const res = await apiFetch('/api/comments', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await readJsonOrThrow<CommentEnvelope>(res);
  return { comment: normalizeRow(body.comment) };
}

export interface UpdateCommentPatch {
  body?: string;
  resolved?: boolean;
}

export async function patchUpdateComment(
  id: string,
  patch: UpdateCommentPatch,
): Promise<{ comment: CommentRow }> {
  const res = await apiFetch(`/api/comments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await readJsonOrThrow<CommentEnvelope>(res);
  return { comment: normalizeRow(body.comment) };
}

export async function deleteComment(id: string): Promise<void> {
  const res = await apiFetch(`/api/comments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 204) {
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === 'string') detail = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(detail ?? `Delete failed: ${res.status}`);
  }
}

// ─── React-Query hooks ──────────────────────────────────────────────────────

export function useComments(
  target: CommentTarget,
  opts: CommentListOptions = {},
  limit: number = DEFAULT_LIMIT,
): UseInfiniteQueryResult<{ pages: CommentPage[]; pageParams: (string | null)[] }, Error> {
  return useInfiniteQuery<
    CommentPage,
    Error,
    { pages: CommentPage[]; pageParams: (string | null)[] },
    ReturnType<typeof QK.thread>,
    string | null
  >({
    queryKey: QK.thread(target, opts),
    queryFn: ({ pageParam }) =>
      fetchCommentsPage(target, opts, pageParam ?? null, limit),
    initialPageParam: null,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

export function useCreateComment(): UseMutationResult<
  { comment: CommentRow },
  Error,
  CreateCommentInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => postCreateComment(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.root });
    },
  });
}

export interface UpdateCommentInput {
  id: string;
  patch: UpdateCommentPatch;
}

export function useUpdateComment(): UseMutationResult<
  { comment: CommentRow },
  Error,
  UpdateCommentInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => patchUpdateComment(id, patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.root });
    },
  });
}

export function useDeleteComment(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => deleteComment(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.root });
    },
  });
}
