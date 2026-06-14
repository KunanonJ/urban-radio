/**
 * AI provider abstraction — shared types.
 *
 * Phase 4 / Wave 6a: capability interfaces + stub implementations + factory swap points.
 * Real provider SDKs (ElevenLabs, Anthropic, Deepgram, AudD) are deferred until API keys
 * are provisioned. The factories in each capability file are the single swap point.
 */

/** Known providers we may plug in. `stub` is the deterministic default used before keys land. */
export type AiProvider =
  | 'elevenlabs'
  | 'anthropic'
  | 'openai'
  | 'deepgram'
  | 'audd'
  | 'stub';

/** Free-form usage report so cost reconciliation can normalize across providers. */
export interface AiUsage {
  /** Unit is provider/capability specific: tokens for text, characters for TTS, seconds for transcribe/ANR. */
  unit: 'tokens' | 'characters' | 'seconds' | 'requests';
  count: number;
  estimatedCostUsd: number;
}

/**
 * Discriminated result envelope. `ok: true` means the operation succeeded and `data` + `usage` are present;
 * `ok: false` means it failed and `error` carries a human-readable reason. `provider` is always present so
 * callers can attribute usage even on failure.
 */
export type AiResult<T> =
  | { ok: true; data: T; usage: AiUsage; provider: AiProvider }
  | { ok: false; error: string; provider: AiProvider };
