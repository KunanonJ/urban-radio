/**
 * Transcribe capability — audio → text + timed caption segments.
 *
 * Wave 6a ships only the deterministic stub. Real providers (Deepgram, AssemblyAI, Whisper) plug in via
 * `createTranscribeProvider` once API keys land — see SWAP POINT below.
 */

import type { AiProvider, AiResult } from './types';

export interface TranscribeOptions {
  audioBase64?: string;
  audioUrl?: string;
  language?: string;
  /** Live caption mode — provider may stream segments. Stub returns a single segment. */
  live?: boolean;
}

export interface TranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export interface TranscribeProvider {
  name: AiProvider;
  transcribe(
    opts: TranscribeOptions,
  ): Promise<AiResult<{ segments: TranscriptSegment[]; fullText: string }>>;
}

/** Deepgram Nova-2 reference price (May 2026): ~$0.0043 per minute → ~$0.0000717 per second. */
const STUB_USD_PER_SECOND = 0.0043 / 60;

const STUB_SEGMENTS: TranscriptSegment[] = [
  { text: '[stub]', startMs: 0, endMs: 400 },
  { text: 'transcribed audio', startMs: 400, endMs: 1000 },
];

export class StubTranscribeProvider implements TranscribeProvider {
  readonly name: AiProvider = 'stub';

  async transcribe(
    opts: TranscribeOptions,
  ): Promise<AiResult<{ segments: TranscriptSegment[]; fullText: string }>> {
    if (!opts.audioBase64 && !opts.audioUrl) {
      return {
        ok: false,
        provider: this.name,
        error: 'No audio input provided (need audioBase64 or audioUrl).',
      };
    }
    const segments = STUB_SEGMENTS.map((s) => ({ ...s }));
    const fullText = segments.map((s) => s.text).join(' ');
    const durationSeconds = segments[segments.length - 1].endMs / 1000;
    return {
      ok: true,
      provider: this.name,
      data: { segments, fullText },
      usage: {
        unit: 'seconds',
        count: durationSeconds,
        estimatedCostUsd: round6(durationSeconds * STUB_USD_PER_SECOND),
      },
    };
  }
}

export interface TranscribeProviderFactoryEnv {
  DEEPGRAM_API_KEY?: string;
  ASSEMBLYAI_API_KEY?: string;
}

/**
 * SWAP POINT — once a Deepgram (or AssemblyAI) adapter ships in Wave 6b, branch on
 * env.DEEPGRAM_API_KEY here. Example:
 *   `if (env.DEEPGRAM_API_KEY) return new DeepgramTranscribeProvider(env.DEEPGRAM_API_KEY);`
 */
export function createTranscribeProvider(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  env: TranscribeProviderFactoryEnv = {},
): TranscribeProvider {
  return new StubTranscribeProvider();
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
