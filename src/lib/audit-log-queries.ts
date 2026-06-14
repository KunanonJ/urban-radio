/**
 * TanStack Query hooks for the Audit Log UI (Phase 5).
 *
 * Backend lives at `GET /api/audit-log` — see
 * `functions/api/audit-log/index.ts`. The list endpoint is cursor-paginated;
 * we expose it via `useInfiniteQuery`. The CSV endpoint is a separate
 * mutation that returns a Blob (the UI triggers a download).
 *
 * This module is the *client-side* hook surface. The server-side SQL builders
 * live at `functions/_lib/audit-log-queries.ts`. The two modules share names
 * but no runtime code — keeping them independent so the server doesn't pull
 * in TanStack and the client doesn't pull in @cloudflare/workers-types.
 */
import {
  useInfiniteQuery,
  useMutation,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-base';

/**
 * Hardcoded union of known `action` values written across the app. Kept here
 * so the filter dropdown can present a stable list. Unknown actions (added by
 * future writers) still show up in the *list*; users just won't be able to
 * narrow by them from the dropdown until the constant is extended.
 */
export const KNOWN_AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'reorder',
  'stream_start',
  'stream_stop',
  'royalty_export',
  'audit_log_export',
  'ai_generate_voice',
  'ai_generate_text',
  'ai_generate_transcribe',
  'ai_generate_anr',
] as const;
export type KnownAuditAction = (typeof KNOWN_AUDIT_ACTIONS)[number];

/** Hardcoded union of known `target_type` values written across the app. */
export const KNOWN_AUDIT_TARGET_TYPES = [
  'clock',
  'clock_slot',
  'schedule_assignment',
  'radio_track',
  'voice_track',
  'station',
  'ai_usage',
] as const;
export type KnownAuditTargetType = (typeof KNOWN_AUDIT_TARGET_TYPES)[number];

export interface AuditLogFilters {
  actorUserId?: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  search?: string;
}

export interface AuditLogActor {
  userId: string | null;
  username: string | null;
}

export interface AuditLogEntry {
  id: string;
  at: string;
  actor: AuditLogActor;
  action: string;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  meta: { nextCursor: string | null; limit: number };
}

interface AuditLogListResponse {
  entries: AuditLogEntry[];
  meta?: { nextCursor?: string | null; limit?: number };
}

async function readJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === 'string') detail = body.error;
    } catch {
      // ignore — fall through to status text
    }
    throw new Error(detail ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

function appendFiltersToParams(params: URLSearchParams, filters: AuditLogFilters): void {
  if (filters.actorUserId) params.set('actorUserId', filters.actorUserId);
  if (filters.action) params.set('action', filters.action);
  if (filters.targetType) params.set('targetType', filters.targetType);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.search) params.set('search', filters.search);
}

/**
 * Build a `/api/audit-log` URL with the filter + paging params. Exported so
 * tests can spot-check the URL we send without spying on `fetch`.
 */
export function buildAuditLogUrl(
  filters: AuditLogFilters,
  cursor: string | null,
  limit: number,
): string {
  const params = new URLSearchParams();
  appendFiltersToParams(params, filters);
  if (cursor) params.set('cursor', cursor);
  params.set('limit', String(limit));
  return `/api/audit-log?${params.toString()}`;
}

export async function fetchAuditLogPage(
  filters: AuditLogFilters,
  cursor: string | null,
  limit: number,
): Promise<AuditLogPage> {
  const res = await apiFetch(buildAuditLogUrl(filters, cursor, limit));
  const body = await readJsonOrThrow<AuditLogListResponse>(res);
  return {
    entries: body.entries ?? [],
    meta: {
      nextCursor: body.meta?.nextCursor ?? null,
      limit: body.meta?.limit ?? limit,
    },
  };
}

/**
 * Fetch the CSV export as a Blob. The caller is responsible for triggering
 * the download (e.g. via `URL.createObjectURL`).
 */
export async function fetchAuditLogCsv(filters: AuditLogFilters): Promise<Blob> {
  const params = new URLSearchParams();
  appendFiltersToParams(params, filters);
  params.set('format', 'csv');
  const res = await apiFetch(`/api/audit-log?${params.toString()}`);
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body.error === 'string') detail = body.error;
    } catch {
      // ignore
    }
    throw new Error(detail ?? `Export failed: ${res.status}`);
  }
  return await res.blob();
}

const QK = {
  list: (filters: AuditLogFilters) => ['audit-log', 'list', filters] as const,
};

const DEFAULT_LIMIT = 50;

export function useAuditLog(
  filters: AuditLogFilters = {},
  limit: number = DEFAULT_LIMIT,
): UseInfiniteQueryResult<{ pages: AuditLogPage[]; pageParams: (string | null)[] }, Error> {
  return useInfiniteQuery<
    AuditLogPage,
    Error,
    { pages: AuditLogPage[]; pageParams: (string | null)[] },
    ReturnType<typeof QK.list>,
    string | null
  >({
    queryKey: QK.list(filters),
    queryFn: ({ pageParam }) => fetchAuditLogPage(filters, pageParam ?? null, limit),
    initialPageParam: null,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

export function useAuditLogCsvExport(): UseMutationResult<Blob, Error, AuditLogFilters> {
  return useMutation({
    mutationFn: async (filters) => fetchAuditLogCsv(filters),
  });
}
