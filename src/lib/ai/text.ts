/**
 * Text generation capability — short DJ script + voice-track copy.
 *
 * Wave 6a ships only the deterministic stub. Real providers (Anthropic Claude, OpenAI) plug in via
 * `createTextProvider` once API keys land — see SWAP POINT below.
 */

import type { AiProvider, AiResult } from './types';

export type TextTopic =
  | 'frontsell'
  | 'backsell'
  | 'fun_fact'
  | 'station_id'
  | 'weather'
  | 'news'
  | 'custom';

export type TextTone = 'energetic' | 'calm' | 'professional' | 'cheeky' | 'morning';

export interface TextGenerationContext {
  artist?: string;
  title?: string;
  album?: string;
  stationName?: string;
  weather?: { tempC: number; description: string };
  /** Free-form fallback used when topic === 'custom' or other topics need extra info. */
  custom?: string;
}

export interface TextGenerationOptions {
  topic: TextTopic;
  tone?: TextTone;
  context?: TextGenerationContext;
  /** Soft cap; provider may stop earlier. Stub truncates on a word boundary when possible. */
  maxChars?: number;
  /** ISO 639-1 language code. */
  language?: string;
}

export interface TextProvider {
  name: AiProvider;
  generate(opts: TextGenerationOptions): Promise<AiResult<{ text: string }>>;
}

/** Anthropic Haiku reference price (May 2026): ~$0.25 per 1M input tokens. Output side handled in real adapter. */
const STUB_USD_PER_TOKEN = 0.25 / 1_000_000;

export class StubTextProvider implements TextProvider {
  readonly name: AiProvider = 'stub';

  async generate(opts: TextGenerationOptions): Promise<AiResult<{ text: string }>> {
    const text = applyMaxChars(renderTemplate(opts), opts.maxChars);
    const tokens = Math.max(1, Math.ceil(text.length / 4));
    return {
      ok: true,
      provider: this.name,
      data: { text },
      usage: {
        unit: 'tokens',
        count: tokens,
        estimatedCostUsd: round6(tokens * STUB_USD_PER_TOKEN),
      },
    };
  }
}

function renderTemplate(opts: TextGenerationOptions): string {
  const ctx = opts.context ?? {};
  const artist = ctx.artist ?? 'an unknown artist';
  const title = ctx.title ?? 'an untitled track';
  const station = ctx.stationName ?? 'Your Station';

  switch (opts.topic) {
    case 'frontsell':
      return `Up next, ${artist} with "${title}".`;
    case 'backsell':
      return `That was ${artist} with "${title}".`;
    case 'fun_fact':
      return `Quick fact: ${artist} recorded "${title}" in one take.`;
    case 'station_id':
      return `You're listening to ${station}.`;
    case 'weather': {
      const w = ctx.weather;
      if (!w) {
        return 'Weather data unavailable.';
      }
      return `It's ${w.tempC}°C and ${w.description} right now.`;
    }
    case 'news':
      return `Top story: ${ctx.custom ?? 'breaking news on the wire'}.`;
    case 'custom':
      return ctx.custom ?? '[stub] custom copy';
    default: {
      /** Exhaustive guard; if a new topic is added without a branch, the type checker yells. */
      const _exhaustive: never = opts.topic;
      return _exhaustive;
    }
  }
}

/** Truncate to a soft cap. Prefers ending on a word boundary; never returns longer than `maxChars`. */
function applyMaxChars(text: string, maxChars?: number): string {
  if (!maxChars || maxChars <= 0 || text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > Math.floor(maxChars * 0.5)) {
    return slice.slice(0, lastSpace);
  }
  return slice;
}

export interface TextProviderFactoryEnv {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

/**
 * SWAP POINT — once an Anthropic adapter ships in Wave 6b, branch on env.ANTHROPIC_API_KEY here.
 * Example: `if (env.ANTHROPIC_API_KEY) return new AnthropicTextProvider(env.ANTHROPIC_API_KEY);`
 */
export function createTextProvider(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  env: TextProviderFactoryEnv = {},
): TextProvider {
  return new StubTextProvider();
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
