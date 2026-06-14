/**
 * ANR — Audio Now-playing Recognition.
 *
 * Used by ROADMAP §5.2 P4-ζ (auto-log incoming streams to `play_log`). Given a short audio sample,
 * the provider returns matched track metadata (title, artist, optional ISRC).
 *
 * Wave 6a ships only the deterministic stub. Real providers (AudD, ACR Cloud) plug in via
 * `createAnrProvider` once API keys land — see SWAP POINT below.
 */

import type { AiProvider, AiResult } from './types';

export interface AnrOptions {
  audioBase64?: string;
  audioUrl?: string;
  /** Sample window in seconds. Defaults to 12 — typical AudD sample length. */
  windowSeconds?: number;
}

export interface AnrMatch {
  title: string;
  artist: string;
  album?: string;
  isrc?: string;
  /** 0..1 — provider's reported similarity / fingerprint confidence. */
  confidence: number;
}

export interface AnrProvider {
  name: AiProvider;
  recognize(opts: AnrOptions): Promise<AiResult<{ matches: AnrMatch[] }>>;
}

/** AudD reference price (May 2026): roughly $0.001 per recognition request. */
const STUB_USD_PER_REQUEST = 0.001;
const DEFAULT_WINDOW_SECONDS = 12;

export class StubAnrProvider implements AnrProvider {
  readonly name: AiProvider = 'stub';

  async recognize(opts: AnrOptions): Promise<AiResult<{ matches: AnrMatch[] }>> {
    if (!opts.audioBase64 && !opts.audioUrl) {
      return {
        ok: false,
        provider: this.name,
        error: 'No audio input provided (need audioBase64 or audioUrl).',
      };
    }
    const windowSeconds = opts.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
    const matches: AnrMatch[] = [
      {
        title: 'Stub Track',
        artist: 'Stub Artist',
        album: 'Stub Album',
        isrc: 'STUB0000000001',
        confidence: 0.95,
      },
    ];
    return {
      ok: true,
      provider: this.name,
      data: { matches },
      usage: {
        unit: 'seconds',
        count: windowSeconds,
        estimatedCostUsd: STUB_USD_PER_REQUEST,
      },
    };
  }
}

export interface AnrProviderFactoryEnv {
  AUDD_API_KEY?: string;
  ACR_CLOUD_KEY?: string;
  ACR_CLOUD_SECRET?: string;
}

/**
 * SWAP POINT — once an AudD or ACR Cloud adapter ships in Wave 6b, branch here. Example:
 *   `if (env.AUDD_API_KEY) return new AuddAnrProvider(env.AUDD_API_KEY);`
 *   `if (env.ACR_CLOUD_KEY && env.ACR_CLOUD_SECRET) return new AcrCloudAnrProvider(...);`
 */
export function createAnrProvider(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  env: AnrProviderFactoryEnv = {},
): AnrProvider {
  return new StubAnrProvider();
}
