/**
 * TanStack Query hooks for the Voice Tracks list page (Phase 4 Wave 5 / S5).
 *
 * Backend lives at `/api/voice-tracks` (CRUD) — see
 * `functions/api/voice-tracks/index.ts` and `functions/api/voice-tracks/[id].ts`.
 *
 * The list endpoint is cursor-paginated; we expose it via `useInfiniteQuery`
 * to match the catalog patterns. Mutations all invalidate the `['voice-tracks']`
 * root key so any mounted list refetches.
 *
 * Note: this is the *client-side* query module. It is separate from the server
 * adapter at `functions/_lib/voice-track-queries.ts` which builds the SQL.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { apiFetch, apiUrl } from '@/lib/api-base';

export const VT_STATUS_VALUES = ['draft', 'ready', 'aired', 'archived'] as const;
export type VoiceTrackStatus = (typeof VT_STATUS_VALUES)[number];

/**
 * Shape returned to the UI. `streamUrl` is derived on the client from
 * `storageKey` so the player has a stable URL to hit without another API
 * round-trip. The backend currently emits the storage key directly; the
 * `/api/voice-tracks/:id/audio` route fronts the R2 object with a signed
 * stream URL, so we point there.
 */
export interface VoiceTrackRow {
  id: string;
  stationId: string;
  recordedBy: string | null;
  storageKey: string;
  streamUrl: string;
  durationMs: number;
  transcript: string | null;
  targetClockSlotId: string | null;
  status: VoiceTrackStatus;
  aiGenerated: 0 | 1 | null;
  createdAt: string;
}

interface VoiceTrackJsonResponse {
  id: string;
  stationId: string;
  recordedBy: string | null;
  storageKey: string;
  streamUrl?: string;
  durationMs: number;
  transcript: string | null;
  targetClockSlotId: string | null;
  status: string;
  aiGenerated: number | null;
  createdAt: string;
}

interface VoiceTracksListResponse {
  voiceTracks: VoiceTrackJsonResponse[];
  meta: { nextCursor: string | null; limit: number };
}

interface VoiceTrackPage {
  voiceTracks: VoiceTrackRow[];
  meta: { nextCursor: string | null; limit: number };
}

function isVoiceTrackStatus(value: string): value is VoiceTrackStatus {
  return (VT_STATUS_VALUES as readonly string[]).includes(value);
}

/**
 * Normalize a raw server VT row to the UI type. Adds a derived `streamUrl`
 * because the server does not (yet) emit one — the `/audio` route fronts the
 * R2 object and is the contract the player expects.
 */
function normalizeRow(raw: VoiceTrackJsonResponse): VoiceTrackRow {
  const status: VoiceTrackStatus = isVoiceTrackStatus(raw.status)
    ? raw.status
    : 'draft';
  const streamUrl = raw.streamUrl ?? apiUrl(`/api/voice-tracks/${encodeURIComponent(raw.id)}/audio`);
  const aiGenerated =
    raw.aiGenerated === 1 ? 1 : raw.aiGenerated === 0 ? 0 : null;
  return {
    id: raw.id,
    stationId: raw.stationId,
    recordedBy: raw.recordedBy,
    storageKey: raw.storageKey,
    streamUrl,
    durationMs: raw.durationMs,
    transcript: raw.transcript,
    targetClockSlotId: raw.targetClockSlotId,
    status,
    aiGenerated,
    createdAt: raw.createdAt,
  };
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

const QK = {
  root: ['voice-tracks'] as const,
  list: (filters: VoiceTrackFilters) => ['voice-tracks', 'list', filters] as const,
};

export interface VoiceTrackFilters {
  status?: VoiceTrackStatus;
}

/**
 * Build a `/api/voice-tracks` URL with the filter + paging params. Exported
 * so tests can spot-check the URL we send without spying on `fetch`.
 */
export function buildVoiceTracksUrl(
  filters: VoiceTrackFilters,
  cursor: string | null,
  limit: number,
): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (cursor) params.set('cursor', cursor);
  params.set('limit', String(limit));
  return `/api/voice-tracks?${params.toString()}`;
}

export async function fetchVoiceTracksPage(
  filters: VoiceTrackFilters,
  cursor: string | null,
  limit: number,
): Promise<VoiceTrackPage> {
  const res = await apiFetch(buildVoiceTracksUrl(filters, cursor, limit));
  const body = await readJsonOrThrow<VoiceTracksListResponse>(res);
  return {
    voiceTracks: (body.voiceTracks ?? []).map(normalizeRow),
    meta: {
      nextCursor: body.meta?.nextCursor ?? null,
      limit: body.meta?.limit ?? limit,
    },
  };
}

const DEFAULT_LIMIT = 50;

export function useVoiceTracks(
  filters: VoiceTrackFilters = {},
  limit: number = DEFAULT_LIMIT,
): UseInfiniteQueryResult<{ pages: VoiceTrackPage[]; pageParams: (string | null)[] }, Error> {
  return useInfiniteQuery<
    VoiceTrackPage,
    Error,
    { pages: VoiceTrackPage[]; pageParams: (string | null)[] },
    ReturnType<typeof QK.list>,
    string | null
  >({
    queryKey: QK.list(filters),
    queryFn: ({ pageParam }) => fetchVoiceTracksPage(filters, pageParam ?? null, limit),
    initialPageParam: null,
    getNextPageParam: (last) => last.meta.nextCursor ?? undefined,
    staleTime: 15_000,
  });
}

// ─── mutations ──────────────────────────────────────────────────────────────

export interface CreateVoiceTrackInput {
  audioBlob: Blob;
  meta: {
    durationMs: number;
    transcript?: string;
    targetClockSlotId?: string;
    status?: VoiceTrackStatus;
    aiGenerated?: boolean;
  };
}

export interface VoiceTrackEnvelope {
  voiceTrack: VoiceTrackRow;
}

/**
 * Build the FormData payload for `POST /api/voice-tracks`. Exported so tests
 * can assert the shape without going through `useMutation`.
 */
export function buildCreateFormData(input: CreateVoiceTrackInput): FormData {
  const form = new FormData();
  // The backend's multipart handler expects a `file` entry that is a Blob/File.
  // We forward the recorded blob verbatim — the backend writes it to R2 as-is.
  form.append('file', input.audioBlob, 'voice-track.webm');
  form.append('meta', JSON.stringify(input.meta));
  return form;
}

export function useCreateVoiceTrack(): UseMutationResult<
  VoiceTrackEnvelope,
  Error,
  CreateVoiceTrackInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input) => {
      const form = buildCreateFormData(input);
      const res = await apiFetch('/api/voice-tracks', {
        method: 'POST',
        body: form,
        // Don't set content-type — the browser builds the multipart boundary.
      });
      const body = await readJsonOrThrow<{ voiceTrack: VoiceTrackJsonResponse }>(res);
      return { voiceTrack: normalizeRow(body.voiceTrack) };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.root });
    },
  });
}

export interface UpdateVoiceTrackInput {
  id: string;
  patch: {
    status?: VoiceTrackStatus;
    transcript?: string | null;
    targetClockSlotId?: string | null;
  };
}

export function useUpdateVoiceTrack(): UseMutationResult<
  VoiceTrackEnvelope,
  Error,
  UpdateVoiceTrackInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }) => {
      const res = await apiFetch(`/api/voice-tracks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await readJsonOrThrow<{ voiceTrack: VoiceTrackJsonResponse }>(res);
      return { voiceTrack: normalizeRow(body.voiceTrack) };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.root });
    },
  });
}

export function useDeleteVoiceTrack(): UseMutationResult<void, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id) => {
      const res = await apiFetch(`/api/voice-tracks/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`Delete failed: ${res.status}`);
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: QK.root });
    },
  });
}
