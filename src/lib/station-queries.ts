/**
 * TanStack Query hooks for the Station Identity endpoint.
 *
 * GET /api/stations/me  → { station }
 * PATCH /api/stations/me → { station } after applying partial patch
 *
 * The PATCH mutation invalidates the ['station'] cache key on success so
 * any concurrent consumer (StationIdentitySection, header, etc.) re-fetches.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-base';

export interface StationRow {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  timezone: string;
  streamUrl: string | null;
  language: string;
  createdAt: string;
}

export interface StationIdentityPatch {
  name?: string;
  timezone?: string;
  language?: string;
  streamUrl?: string | null;
}

export interface StationResponse {
  station: StationRow;
}

export const STATION_QUERY_KEY = ['station'] as const;

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

export async function fetchStation(): Promise<StationResponse> {
  const res = await apiFetch('/api/stations/me');
  return readJson<StationResponse>(res);
}

export async function patchStation(
  patch: StationIdentityPatch,
): Promise<StationResponse> {
  const res = await apiFetch('/api/stations/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return readJson<StationResponse>(res);
}

export function useStation(): UseQueryResult<StationResponse, Error> {
  return useQuery({
    queryKey: STATION_QUERY_KEY,
    queryFn: fetchStation,
    staleTime: 30_000,
  });
}

export function useUpdateStation(): UseMutationResult<
  StationResponse,
  Error,
  StationIdentityPatch
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchStation,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: STATION_QUERY_KEY });
    },
  });
}
