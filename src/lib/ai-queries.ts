/**
 * TanStack Query hooks for the AI capability endpoints
 * (`/api/ai/voice/list`, `/api/ai/text/generate`, `/api/ai/voice/synthesize`).
 *
 * Phase 4 / Wave 6c consumers:
 *   - `VoiceTrackAiDrawer` (this wave) — pick voice + topic, generate text, then audio.
 *   - Live Studio Quick VT panel (other agent) — same hooks, different UI shell.
 *
 * The cost-guard backend returns HTTP 402 with
 *   `{ ok: false, error: 'cap_hit', reason, remainingUsd, remainingPct }`
 * when an org has burned through its plan cap. We surface that as a typed
 * `CapHitError` so the UI can show a graceful upsell instead of a raw 402.
 */
import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-base';

/** Mirrors `AiUsage` from `@/lib/ai` — duplicated here to avoid pulling the server bundle into the client tree. */
export interface AiUsageJson {
  unit: 'tokens' | 'characters' | 'seconds' | 'requests';
  count: number;
  estimatedCostUsd: number;
}

export interface AiTextResponse {
  ok: boolean;
  data?: { text: string };
  error?: string;
  reason?: string;
  usage?: AiUsageJson;
  provider?: string;
}

export interface AiVoiceResponse {
  ok: boolean;
  data?: { audioBase64: string };
  error?: string;
  reason?: string;
  usage?: AiUsageJson;
  provider?: string;
}

export interface VoiceListItem {
  id: string;
  name: string;
  scope: 'cloned' | 'stock';
  language?: string;
  previewUrl?: string;
}

export interface VoiceListResponse {
  voices: VoiceListItem[];
  provider?: string;
}

export type GenerateTextInput = {
  topic: string;
  tone?: string;
  context?: unknown;
  maxChars?: number;
  language?: string;
};

export type GenerateVoiceInput = {
  text: string;
  voiceId: string;
};

/**
 * Thrown when the server returns HTTP 402 — the org has hit its plan cap.
 * UI should surface the `reason` + `remainingUsd` rather than a generic error.
 */
export class CapHitError extends Error {
  public readonly reason: string;
  public readonly remainingUsd: number;

  constructor(reason: string, remainingUsd: number) {
    super('cap_hit');
    this.name = 'CapHitError';
    this.reason = reason;
    this.remainingUsd = remainingUsd;
    // Maintain prototype chain for `instanceof` checks across transpilation.
    Object.setPrototypeOf(this, CapHitError.prototype);
  }
}

/**
 * Parse a 402 body shape `{ ok: false, error: 'cap_hit', reason, remainingUsd }`.
 * Defensive: missing fields fall back to safe defaults.
 */
async function throwCapHit(res: Response): Promise<never> {
  let reason = 'cap_hit';
  let remainingUsd = 0;
  try {
    const body = (await res.json()) as {
      reason?: string;
      remainingUsd?: number;
      error?: string;
    };
    if (typeof body.reason === 'string' && body.reason.length > 0) {
      reason = body.reason;
    }
    if (typeof body.remainingUsd === 'number' && Number.isFinite(body.remainingUsd)) {
      remainingUsd = body.remainingUsd;
    }
  } catch {
    /* swallow — keep defaults */
  }
  throw new CapHitError(reason, remainingUsd);
}

async function throwProviderError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = (await res.json()) as { error?: string };
    if (typeof body.error === 'string' && body.error.length > 0) {
      message = body.error;
    }
  } catch {
    /* swallow */
  }
  throw new Error(message);
}

// ─── voice list (GET) ──────────────────────────────────────────────────────

export const VOICE_LIST_QUERY_KEY = ['ai', 'voice', 'list'] as const;

async function fetchVoiceList(
  scope: 'cloned' | 'stock' | 'all',
): Promise<VoiceListResponse> {
  const qs = new URLSearchParams({ scope }).toString();
  const res = await apiFetch(`/api/ai/voice/list?${qs}`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    ok: boolean;
    data?: VoiceListItem[];
    provider?: string;
  };
  return {
    voices: body.data ?? [],
    provider: body.provider,
  };
}

export function useVoiceList(
  scope: 'cloned' | 'stock' | 'all' = 'all',
): UseQueryResult<VoiceListResponse, Error> {
  return useQuery({
    queryKey: [...VOICE_LIST_QUERY_KEY, scope],
    queryFn: () => fetchVoiceList(scope),
    staleTime: 5 * 60_000,
  });
}

// ─── text generation (POST) ────────────────────────────────────────────────

export function useGenerateText(): UseMutationResult<
  AiTextResponse,
  Error,
  GenerateTextInput
> {
  return useMutation({
    mutationFn: async (input) => {
      const res = await apiFetch('/api/ai/text/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (res.status === 402) {
        await throwCapHit(res);
      }
      if (!res.ok) {
        await throwProviderError(res, `text/generate ${res.status}`);
      }
      return (await res.json()) as AiTextResponse;
    },
  });
}

// ─── voice synthesis (POST) ────────────────────────────────────────────────

export function useGenerateVoice(): UseMutationResult<
  AiVoiceResponse,
  Error,
  GenerateVoiceInput
> {
  return useMutation({
    mutationFn: async (input) => {
      const res = await apiFetch('/api/ai/voice/synthesize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (res.status === 402) {
        await throwCapHit(res);
      }
      if (!res.ok) {
        await throwProviderError(res, `voice/synthesize ${res.status}`);
      }
      return (await res.json()) as AiVoiceResponse;
    },
  });
}
