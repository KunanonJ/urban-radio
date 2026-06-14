/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import { createTextProvider } from '@/lib/ai';
import { runAiCapability } from '../../../_lib/ai-bridge';
import type { SonicBloomEnv } from '../../../_lib/env';
import { requireStation } from '../../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

/** Stub Anthropic Haiku tokens are tiny; front-load $0.005 to keep callers honest. */
const FRONT_LOAD_USD = 0.005;

const TEXT_TOPICS = [
  'frontsell',
  'backsell',
  'fun_fact',
  'station_id',
  'weather',
  'news',
  'custom',
] as const;
const TEXT_TONES = ['energetic', 'calm', 'professional', 'cheeky', 'morning'] as const;

const generateSchema = z.object({
  topic: z.enum(TEXT_TOPICS),
  tone: z.enum(TEXT_TONES).optional(),
  context: z
    .object({
      artist: z.string().max(500).optional(),
      title: z.string().max(500).optional(),
      album: z.string().max(500).optional(),
      stationName: z.string().max(120).optional(),
      weather: z
        .object({
          tempC: z.number(),
          description: z.string().max(120),
        })
        .optional(),
      custom: z.string().max(2000).optional(),
    })
    .optional(),
  maxChars: z.number().int().positive().max(2000).optional(),
  language: z.string().min(2).max(8).optional(),
});

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;

  let raw: unknown;
  try {
    raw = await ctx.request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = generateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const provider = createTextProvider({
    ANTHROPIC_API_KEY: (ctx.env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY,
    OPENAI_API_KEY: (ctx.env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY,
  });

  /** request_summary is a short label of the request topic for audit grepability. */
  const summary = `${parsed.data.topic}${
    parsed.data.context?.title ? `: ${parsed.data.context.title}` : ''
  }`;

  return runAiCapability(ctx.env, gate, {
    capability: 'text',
    estimatedCostUsd: FRONT_LOAD_USD,
    requestSummary: summary,
    run: () => provider.generate(parsed.data),
  });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
