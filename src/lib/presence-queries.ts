/**
 * TanStack Query hooks for the slim REST-polling presence system (Phase 6.1).
 *
 * Backend lives at:
 *   POST /api/presence/heartbeat         — refreshes my session, returns active list
 *   GET  /api/presence?targetType=&id=   — read-only fetch of active sessions
 *
 * `usePresenceFor` polls every 5s. `useSendPresenceHeartbeat` is a mutation
 * that the heartbeat hook fires on a 5s timer while a collaborative view is
 * mounted. Both endpoints return the same active-session payload so the
 * mutation can hydrate the same query cache.
 *
 * Note: this is the *client-side* query module. It is separate from the
 * server-side SQL builder at `functions/_lib/presence-queries.ts`.
 *
 * Deferred (Phase 6.2): WebSocket / Durable Object push, CRDT-backed edit
 * locks, joined/left notifications.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-base';

export const PRESENCE_TARGET_TYPES = [
  'clock',
  'clock_slot',
  'schedule_assignment',
  'voice_track',
  'radio_track',
  'schedule_cell',
] as const;

export type PresenceTargetType = (typeof PRESENCE_TARGET_TYPES)[number];

export const PRESENCE_POLL_INTERVAL_MS = 5000;
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 5000;

export interface PresenceTarget {
  type: PresenceTargetType;
  id: string;
}

export interface PresenceSession {
  id: string;
  userId: string;
  username: string | null;
  targetType: PresenceTargetType;
  targetId: string;
  lastHeartbeatAt: string;
  createdAt: string;
}

export interface PresenceResponse {
  sessions: PresenceSession[];
  meta: { ttlSeconds: number };
}

interface PresenceSessionJson {
  id: string;
  userId: string;
  username: string | null;
  targetType: string;
  targetId: string;
  lastHeartbeatAt: string;
  createdAt: string;
}

interface PresenceResponseJson {
  sessions: PresenceSessionJson[];
  meta: { ttlSeconds: number };
}

function isPresenceTargetType(value: string): value is PresenceTargetType {
  return (PRESENCE_TARGET_TYPES as readonly string[]).includes(value);
}

function normalizeSession(raw: PresenceSessionJson): PresenceSession {
  // Defensive: server enforces the enum, but if a future migration adds a
  // type the client doesn't know about yet, fall back to 'clock' to avoid
  // crashing the avatar stack.
  const targetType: PresenceTargetType = isPresenceTargetType(raw.targetType)
    ? raw.targetType
    : 'clock';
  return {
    id: raw.id,
    userId: raw.userId,
    username: raw.username,
    targetType,
    targetId: raw.targetId,
    lastHeartbeatAt: raw.lastHeartbeatAt,
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
      /* fall through to status text */
    }
    throw new Error(detail ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

const QK = {
  root: ['presence'] as const,
  target: (target: PresenceTarget) =>
    ['presence', target.type, target.id] as const,
};

export function buildPresenceUrl(target: PresenceTarget): string {
  const params = new URLSearchParams();
  params.set('targetType', target.type);
  params.set('targetId', target.id);
  return `/api/presence?${params.toString()}`;
}

export async function fetchPresence(target: PresenceTarget): Promise<PresenceResponse> {
  const res = await apiFetch(buildPresenceUrl(target));
  const body = await readJsonOrThrow<PresenceResponseJson>(res);
  return {
    sessions: (body.sessions ?? []).map(normalizeSession),
    meta: { ttlSeconds: body.meta?.ttlSeconds ?? 15 },
  };
}

export interface SendHeartbeatInput {
  targetType: PresenceTargetType;
  targetId: string;
}

export async function postPresenceHeartbeat(
  input: SendHeartbeatInput,
): Promise<PresenceResponse> {
  const res = await apiFetch('/api/presence/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await readJsonOrThrow<PresenceResponseJson>(res);
  return {
    sessions: (body.sessions ?? []).map(normalizeSession),
    meta: { ttlSeconds: body.meta?.ttlSeconds ?? 15 },
  };
}

// ─── React-Query hooks ──────────────────────────────────────────────────────

/**
 * Poll the active-session list for `target` every 5s. Stops on unmount.
 * The heartbeat mutation pushes its response into the same cache key, so a
 * caller who heartbeats AND observes a target will see updates immediately
 * without waiting for the next poll tick.
 */
export function usePresenceFor(
  target: PresenceTarget,
): UseQueryResult<PresenceResponse, Error> {
  return useQuery<PresenceResponse, Error>({
    queryKey: QK.target(target),
    queryFn: () => fetchPresence(target),
    refetchInterval: PRESENCE_POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}

/**
 * Heartbeat mutation. On success, the response is hydrated into the
 * `usePresenceFor` cache for the same (targetType, targetId) so the avatar
 * stack updates in the same round-trip.
 */
export function useSendPresenceHeartbeat(): UseMutationResult<
  PresenceResponse,
  Error,
  SendHeartbeatInput
> {
  const qc = useQueryClient();
  return useMutation<PresenceResponse, Error, SendHeartbeatInput>({
    mutationFn: (input) => postPresenceHeartbeat(input),
    onSuccess: (data, variables) => {
      qc.setQueryData(
        QK.target({ type: variables.targetType, id: variables.targetId }),
        data,
      );
    },
  });
}
