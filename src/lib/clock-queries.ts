/**
 * TanStack Query hooks for the Hour Clock Builder (Phase 2 Wave 4 / S2).
 *
 * All hooks talk to `/api/clocks/*` via `apiFetch`. Responses are bare —
 * `{ clocks, meta }`, `{ clock }`, `{ slot }` — not enveloped.
 *
 * NOTE: GET /api/clocks/:id returns slots with `slot_type` (snake_case);
 * POST /api/clocks/:id/slots returns `slotType` (camelCase). We normalize
 * to camelCase `slotType` at the hook boundary so consumers never see the
 * mismatch.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-base';

export const CLOCK_SLOT_TYPES = [
  'music',
  'sweeper',
  'liner',
  'vt',
  'id',
  'news',
  'weather',
  'spot',
  'bed',
  'custom',
] as const;

export type ClockSlotType = (typeof CLOCK_SLOT_TYPES)[number];

export interface ClockRow {
  id: string;
  stationId?: string;
  name: string;
  color: string;
  targetDurationMs: number;
  createdAt: string;
}

export interface ClockSlot {
  id: string;
  /**
   * Server returns `position` for slots — we propagate it. Position is the
   * ordinal index within the clock.
   */
  position: number;
  slotType: ClockSlotType;
  categoryId: string | null;
  durationEstimateMs: number;
  rulesJson: string | null;
}

export interface ClockDetail extends ClockRow {
  slots: ClockSlot[];
}

interface ApiClocksList {
  clocks: ClockRow[];
  meta?: { limit?: number };
}

interface ApiClockDetailRawSlot {
  id: string;
  position: number;
  // GET returns `slot_type`, POST returns `slotType`. Accept both.
  slot_type?: string;
  slotType?: string;
  categoryId: string | null;
  durationEstimateMs: number;
  rulesJson: string | null;
}

interface ApiClockDetailRaw extends ClockRow {
  slots: ApiClockDetailRawSlot[];
}

function isClockSlotType(value: string | undefined): value is ClockSlotType {
  if (!value) return false;
  return (CLOCK_SLOT_TYPES as readonly string[]).includes(value);
}

function normalizeSlot(raw: ApiClockDetailRawSlot): ClockSlot {
  const typeRaw = raw.slotType ?? raw.slot_type ?? 'custom';
  const slotType: ClockSlotType = isClockSlotType(typeRaw) ? typeRaw : 'custom';
  return {
    id: raw.id,
    position: raw.position,
    slotType,
    categoryId: raw.categoryId ?? null,
    durationEstimateMs: raw.durationEstimateMs ?? 0,
    rulesJson: raw.rulesJson ?? null,
  };
}

function normalizeClockDetail(raw: ApiClockDetailRaw): ClockDetail {
  return {
    id: raw.id,
    stationId: raw.stationId,
    name: raw.name,
    color: raw.color ?? '#3b82f6',
    targetDurationMs: raw.targetDurationMs ?? 3600000,
    createdAt: raw.createdAt,
    slots: (raw.slots ?? [])
      .map(normalizeSlot)
      .sort((a, b) => a.position - b.position),
  };
}

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail: string | undefined;
    try {
      const body = await res.json();
      if (body && typeof body === 'object' && 'error' in body) {
        detail = String((body as { error: unknown }).error);
      }
    } catch {
      // swallow — fall back to status text
    }
    throw new Error(detail ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

const QK = {
  list: ['clocks'] as const,
  detail: (id: string) => ['clocks', id] as const,
};

// ─── queries ────────────────────────────────────────────────────────────────

export async function fetchClocks(): Promise<{ clocks: ClockRow[] }> {
  const res = await apiFetch('/api/clocks');
  const body = await readJson<ApiClocksList>(res);
  return { clocks: body.clocks ?? [] };
}

export async function fetchClock(id: string): Promise<ClockDetail> {
  const res = await apiFetch(`/api/clocks/${encodeURIComponent(id)}`);
  const body = await readJson<{ clock: ApiClockDetailRaw }>(res);
  return normalizeClockDetail(body.clock);
}

export function useClocks(): UseQueryResult<{ clocks: ClockRow[] }, Error> {
  return useQuery({
    queryKey: QK.list,
    queryFn: fetchClocks,
    staleTime: 30_000,
  });
}

export function useClock(
  id: string | undefined,
): UseQueryResult<ClockDetail, Error> {
  return useQuery({
    queryKey: id ? QK.detail(id) : ['clocks', '__none__'],
    queryFn: () => fetchClock(id!),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

// ─── clock mutations ────────────────────────────────────────────────────────

export interface CreateClockInput {
  name: string;
  color?: string;
  targetDurationMs?: number;
}

export function useCreateClock(): UseMutationResult<
  { clock: ClockRow },
  Error,
  CreateClockInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const res = await apiFetch('/api/clocks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      return readJson<{ clock: ClockRow }>(res);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.list });
    },
  });
}

export interface UpdateClockInput {
  id: string;
  name?: string;
  color?: string;
  targetDurationMs?: number;
}

export function useUpdateClock(): UseMutationResult<
  { clock: ClockDetail },
  Error,
  UpdateClockInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const { id, ...patch } = input;
      const res = await apiFetch(`/api/clocks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await readJson<{ clock: ApiClockDetailRaw }>(res);
      return { clock: normalizeClockDetail(body.clock) };
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: QK.list });
      void qc.invalidateQueries({ queryKey: QK.detail(vars.id) });
    },
  });
}

export function useDeleteClock(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const res = await apiFetch(`/api/clocks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed: ${res.status}`);
      }
    },
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: QK.list });
      qc.removeQueries({ queryKey: QK.detail(id) });
    },
  });
}

// ─── slot mutations ─────────────────────────────────────────────────────────

export interface AddSlotInput {
  clockId: string;
  position: number;
  slotType: ClockSlotType;
  categoryId?: string | null;
  durationEstimateMs: number;
  rulesJson?: string | null;
}

export function useAddSlot(): UseMutationResult<
  { slot: ClockSlot },
  Error,
  AddSlotInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const { clockId, ...payload } = input;
      const res = await apiFetch(
        `/api/clocks/${encodeURIComponent(clockId)}/slots`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      const body = await readJson<{ slot: ApiClockDetailRawSlot }>(res);
      return { slot: normalizeSlot(body.slot) };
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: QK.detail(vars.clockId) });
    },
  });
}

export interface UpdateSlotInput {
  clockId: string;
  slotId: string;
  position?: number;
  slotType?: ClockSlotType;
  categoryId?: string | null;
  durationEstimateMs?: number;
  rulesJson?: string | null;
}

export function useUpdateSlot(): UseMutationResult<
  { ok: true },
  Error,
  UpdateSlotInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const { clockId, slotId, ...patch } = input;
      const res = await apiFetch(
        `/api/clocks/${encodeURIComponent(clockId)}/slots/${encodeURIComponent(slotId)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        },
      );
      await readJson<{ ok: true }>(res);
      return { ok: true };
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: QK.detail(vars.clockId) });
    },
  });
}

export interface DeleteSlotInput {
  clockId: string;
  slotId: string;
}

export function useDeleteSlot(): UseMutationResult<void, Error, DeleteSlotInput> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clockId, slotId }) => {
      const res = await apiFetch(
        `/api/clocks/${encodeURIComponent(clockId)}/slots/${encodeURIComponent(slotId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed: ${res.status}`);
      }
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: QK.detail(vars.clockId) });
    },
  });
}

export interface ReorderSlotsInput {
  clockId: string;
  order: { id: string; position: number }[];
}

export function useReorderSlots(): UseMutationResult<
  { ok: true },
  Error,
  ReorderSlotsInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ clockId, order }) => {
      const res = await apiFetch(
        `/api/clocks/${encodeURIComponent(clockId)}/slots`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ order }),
        },
      );
      await readJson<{ ok: true }>(res);
      return { ok: true };
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: QK.detail(vars.clockId) });
    },
  });
}
