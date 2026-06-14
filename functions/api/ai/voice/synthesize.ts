/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import { createVoiceProvider } from '@/lib/ai';
import { runAiCapability } from '../../../_lib/ai-bridge';
import type { SonicBloomEnv } from '../../../_lib/env';
import { requireStation } from '../../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

/**
 * Pre-call cost estimate used by the cost-guard. The real cost is whatever the
 * provider reports in `AiResult.usage`. We front-load $0.01 to be safe — at
 * stub character prices ($0.0003/char) that covers ~33 chars; real ElevenLabs
 * synthesis of a typical 250-char DJ line costs ~$0.075 so the guard mostly
 * protects against a runaway plan-cap edge.
 */
const FRONT_LOAD_USD = 0.01;

const synthesizeSchema = z.object({
  text: z.string().trim().min(1, 'text is required').max(5000),
  voiceId: z.string().trim().min(1, 'voiceId is required').max(120),
  format: z.enum(['mp3', 'wav', 'pcm']).optional(),
  stability: z.number().min(0).max(1).optional(),
  similarity: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
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
  const parsed = synthesizeSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const provider = createVoiceProvider({
    ELEVENLABS_API_KEY: (ctx.env as { ELEVENLABS_API_KEY?: string }).ELEVENLABS_API_KEY,
    OPENAI_API_KEY: (ctx.env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY,
  });

  return runAiCapability(ctx.env, gate, {
    capability: 'voice',
    estimatedCostUsd: FRONT_LOAD_USD,
    requestSummary: parsed.data.text,
    run: () => provider.synthesize(parsed.data),
  });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
