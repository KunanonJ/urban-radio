/**
 * TanStack Query hook for the Live Studio health strip (Phase 3 Wave 5b).
 *
 * Polls `GET /api/stream/status` every 5s by default. The endpoint is
 * provided by the Cloudflare Functions adapter at
 * `functions/api/stream/status.ts` (see `getStreamControl()`); the
 * stub adapter returns `source: 'stub'` so the UI can render a "Demo mode"
 * pill until the AzuraCast adapter lands.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-base';

export interface StreamStatus {
  connected: boolean;
  mountPoint: string | null;
  listeners: number;
  bitrate: number | null;
  uptimeSeconds: number;
  source: 'azuracast' | 'stub' | 'fly-liquidsoap';
}

export interface StreamStatusJson {
  status: StreamStatus;
}

export const STREAM_STATUS_QUERY_KEY = ['stream', 'status'] as const;

export interface UseStreamStatusOptions {
  /** Polling interval in ms. Defaults to 5_000. Pass `false` to disable. */
  refetchInterval?: number | false;
}

export async function fetchStreamStatus(): Promise<StreamStatusJson> {
  const res = await apiFetch('/api/stream/status', { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return (await res.json()) as StreamStatusJson;
}

export function useStreamStatus(
  opts?: UseStreamStatusOptions,
): UseQueryResult<StreamStatusJson, Error> {
  return useQuery<StreamStatusJson, Error>({
    queryKey: STREAM_STATUS_QUERY_KEY,
    queryFn: fetchStreamStatus,
    refetchInterval: opts?.refetchInterval ?? 5000,
  });
}
