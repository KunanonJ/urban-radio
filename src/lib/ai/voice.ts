/**
 * Voice capability — TTS synthesis + voice library listing.
 *
 * Wave 6a ships only the deterministic stub. Real providers (ElevenLabs, OpenAI TTS) plug in via
 * `createVoiceProvider` once API keys land — see SWAP POINT below.
 */

import type { AiProvider, AiResult } from './types';

export interface VoiceOptions {
  text: string;
  voiceId: string; // e.g. 'cloned-host-mike', 'stock-female-warm'
  format?: 'mp3' | 'wav' | 'pcm';
  stability?: number; // 0..1
  similarity?: number; // 0..1
  style?: number; // 0..1
}

export interface ListVoicesOptions {
  scope?: 'cloned' | 'stock' | 'all';
}

export interface VoiceInfo {
  id: string;
  name: string;
  scope: 'cloned' | 'stock';
  language?: string;
  previewUrl?: string;
}

export interface VoiceProvider {
  name: AiProvider;
  /** Audio bytes returned as a base64-encoded string so the result is portable across worker/edge runtimes. */
  synthesize(opts: VoiceOptions): Promise<AiResult<{ audioBase64: string }>>;
  listVoices(opts?: ListVoicesOptions): Promise<AiResult<VoiceInfo[]>>;
}

/** ElevenLabs reference price (May 2026): roughly $0.30 per 1k characters on the Creator tier. */
const STUB_USD_PER_CHARACTER = 0.0003;

/**
 * Deterministic 32-bit FNV-1a hash. Used so a given text always maps to the same fake audio payload,
 * which lets tests + dev pipelines treat the stub like a pure function.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const STUB_LIBRARY: VoiceInfo[] = [
  { id: 'cloned-host-mike', name: 'Mike (Cloned Host)', scope: 'cloned', language: 'en' },
  { id: 'cloned-host-nina', name: 'Nina (Cloned Host)', scope: 'cloned', language: 'en' },
  { id: 'stock-female-warm', name: 'Stock — Female / Warm', scope: 'stock', language: 'en' },
  { id: 'stock-male-energetic', name: 'Stock — Male / Energetic', scope: 'stock', language: 'en' },
];

export class StubVoiceProvider implements VoiceProvider {
  readonly name: AiProvider = 'stub';

  async synthesize(opts: VoiceOptions): Promise<AiResult<{ audioBase64: string }>> {
    const characters = opts.text.length;
    /** Deterministic fake payload — base64 of `fake-audio-<voiceId>-<hash>`. */
    const tag = `fake-audio-${opts.voiceId}-${fnv1a(opts.text)}`;
    const audioBase64 = encodeBase64Utf8(tag);
    return {
      ok: true,
      provider: this.name,
      data: { audioBase64 },
      usage: {
        unit: 'characters',
        count: characters,
        estimatedCostUsd: round6(characters * STUB_USD_PER_CHARACTER),
      },
    };
  }

  async listVoices(opts: ListVoicesOptions = {}): Promise<AiResult<VoiceInfo[]>> {
    const scope = opts.scope ?? 'all';
    const filtered = scope === 'all' ? STUB_LIBRARY : STUB_LIBRARY.filter((v) => v.scope === scope);
    return {
      ok: true,
      provider: this.name,
      data: filtered.map((v) => ({ ...v })),
      usage: { unit: 'requests', count: 1, estimatedCostUsd: 0 },
    };
  }
}

export interface VoiceProviderFactoryEnv {
  ELEVENLABS_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

/**
 * SWAP POINT — once an ElevenLabs (or OpenAI TTS) adapter is implemented in Wave 6b, branch on the
 * relevant env var here and return the real provider. Until then we always return the stub so the
 * UI + tests can iterate without API keys.
 *
 * Example future shape:
 *   if (env.ELEVENLABS_API_KEY) return new ElevenLabsVoiceProvider(env.ELEVENLABS_API_KEY);
 */
export function createVoiceProvider(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  env: VoiceProviderFactoryEnv = {},
): VoiceProvider {
  return new StubVoiceProvider();
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Tiny base64 helper that works on both Node (Buffer) and Workers (btoa). */
function encodeBase64Utf8(input: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64');
  }
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(input)));
  }
  /** Fallback: hex-encode (still deterministic, still portable). */
  return Array.from(input)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}
