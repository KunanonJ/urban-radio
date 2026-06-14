/**
 * TanStack Query hooks for the Scheduler grid (Phase 2 Wave 4 / S3).
 *
 * All hooks talk to `/api/schedule[/:id]` via `apiFetch`. Server response shapes
 * (verified against `functions/api/schedule/*.ts`):
 *   GET    /api/schedule              → { assignments: [...], source: 'd1' }
 *   GET    /api/schedule/:id          → { assignment: {...},  source: 'd1' }
 *   POST   /api/schedule              → 201 { assignment } | 409 { error: 'overlap', conflicts }
 *   POST   /api/schedule?force=1      → 201 { assignment, overrode: [...] }
 *   PATCH  /api/schedule/:id          → 200 { assignment, overrode? } | 409 { error, conflicts }
 *   PATCH  /api/schedule/:id?force=1  → 200 { assignment, overrode: [...] }
 *   DELETE /api/schedule/:id          → 200 { ok: true, deleted }
 *
 * 409 responses surface as a `ConflictError` so the UI can open the resolution
 * dialog. All other non-2xx responses raise a generic Error with the server's
 * `error` field when present.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-base';

export interface ScheduleAssignment {
  id: string;
  stationId: string;
  clockId: string;
  /** 0 = Sun … 6 = Sat */
  weekday: number;
  /** 0..23 */
  hour: number;
  validFrom: string | null;
  validUntil: string | null;
  rrule: string | null;
  /** Server timestamp; may be absent on optimistic responses. */
  createdAt?: string;
}

interface ScheduleListResponse {
  assignments: ScheduleAssignment[];
  source?: string;
}

interface ScheduleMutationResponse {
  assignment: ScheduleAssignment;
  overrode?: ScheduleAssignment[];
}

interface ScheduleConflictResponse {
  error: string;
  conflicts: ScheduleAssignment[];
}

/**
 * Thrown when the server returns 409 because the (weekday, hour) cell is
 * already occupied. The UI catches this to open the resolution dialog.
 */
export class ConflictError extends Error {
  readonly conflicts: ScheduleAssignment[];
  constructor(conflicts: ScheduleAssignment[]) {
    super('Conflict');
    this.name = 'ConflictError';
    this.conflicts = conflicts;
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (res.status === 409) {
    let body: ScheduleConflictResponse;
    try {
      body = (await res.json()) as ScheduleConflictResponse;
    } catch {
      throw new ConflictError([]);
    }
    throw new ConflictError(body.conflicts ?? []);
  }
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (body && typeof body === 'object' && 'error' in body) {
        detail = String(body.error);
      }
    } catch {
      // swallow — fall back to status text
    }
    throw new Error(detail ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

const QK = {
  list: (filters?: { weekday?: number; hour?: number }) =>
    ['schedule', 'assignments', filters ?? {}] as const,
  all: ['schedule', 'assignments'] as const,
};

// ─── queries ────────────────────────────────────────────────────────────────

export interface ScheduleListFilters {
  weekday?: number;
  hour?: number;
}

export async function fetchScheduleAssignments(
  filters: ScheduleListFilters = {},
): Promise<{ assignments: ScheduleAssignment[] }> {
  const params = new URLSearchParams();
  if (typeof filters.weekday === 'number') {
    params.set('weekday', String(filters.weekday));
  }
  if (typeof filters.hour === 'number') {
    params.set('hour', String(filters.hour));
  }
  const qs = params.toString();
  const path = `/api/schedule${qs ? `?${qs}` : ''}`;
  const res = await apiFetch(path);
  const body = await parseJsonOrThrow<ScheduleListResponse>(res);
  return { assignments: body.assignments ?? [] };
}

export function useScheduleAssignments(
  filters: ScheduleListFilters = {},
): UseQueryResult<{ assignments: ScheduleAssignment[] }, Error> {
  return useQuery({
    queryKey: QK.list(filters),
    queryFn: () => fetchScheduleAssignments(filters),
    staleTime: 30_000,
  });
}

// ─── mutations ──────────────────────────────────────────────────────────────

export interface CreateAssignmentInput {
  clockId: string;
  weekday: number;
  hour: number;
  rrule?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  /** When true, deletes any conflicting assignment first (server `?force=1`). */
  force?: boolean;
}

export function useCreateAssignment(): UseMutationResult<
  ScheduleMutationResponse,
  Error | ConflictError,
  CreateAssignmentInput
> {
  const qc = useQueryClient();
  return useMutation<ScheduleMutationResponse, Error | ConflictError, CreateAssignmentInput>({
    mutationFn: async (input) => {
      const { force, ...payload } = input;
      const path = `/api/schedule${force ? '?force=1' : ''}`;
      const res = await apiFetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return parseJsonOrThrow<ScheduleMutationResponse>(res);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.all });
    },
  });
}

export interface UpdateAssignmentInput {
  id: string;
  clockId?: string;
  weekday?: number;
  hour?: number;
  rrule?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  force?: boolean;
}

export function useUpdateAssignment(): UseMutationResult<
  ScheduleMutationResponse,
  Error | ConflictError,
  UpdateAssignmentInput
> {
  const qc = useQueryClient();
  return useMutation<ScheduleMutationResponse, Error | ConflictError, UpdateAssignmentInput>({
    mutationFn: async (input) => {
      const { id, force, ...patch } = input;
      const path = `/api/schedule/${encodeURIComponent(id)}${force ? '?force=1' : ''}`;
      const res = await apiFetch(path, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      return parseJsonOrThrow<ScheduleMutationResponse>(res);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.all });
    },
  });
}

export function useDeleteAssignment(): UseMutationResult<
  { ok: true; deleted: ScheduleAssignment },
  Error,
  string
> {
  const qc = useQueryClient();
  return useMutation<{ ok: true; deleted: ScheduleAssignment }, Error, string>({
    mutationFn: async (id) => {
      const res = await apiFetch(`/api/schedule/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      return parseJsonOrThrow<{ ok: true; deleted: ScheduleAssignment }>(res);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.all });
    },
  });
}
