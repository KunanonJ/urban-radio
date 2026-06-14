/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import { createTranscribeProvider } from '@/lib/ai';
import { runAiCapability } from '../../_lib/ai-bridge';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

/** Deepgram Nova-2 is ~$0.0043/min; front-load $0.01 (~2 min budget) per request. */
const FRONT_LOAD_USD = 0.01;

const transcribeSchema = z
  .object({
    audioBase64: z.string().min(1).optional(),
    audioUrl: z.string().url().optional(),
    language: z.string().min(2).max(8).optional(),
    live: z.boolean().optional(),
  })
  .refine((v) => v.audioBase64 || v.audioUrl, {
    message: 'audioBase64 or audioUrl is required',
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
  const parsed = transcribeSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const provider = createTranscribeProvider({
    DEEPGRAM_API_KEY: (ctx.env as { DEEPGRAM_API_KEY?: string }).DEEPGRAM_API_KEY,
    ASSEMBLYAI_API_KEY: (ctx.env as { ASSEMBLYAI_API_KEY?: string }).ASSEMBLYAI_API_KEY,
  });

  const summary = parsed.data.audioUrl ?? `inline-audio-${parsed.data.audioBase64?.length ?? 0}b`;

  return runAiCapability(ctx.env, gate, {
    capability: 'transcribe',
    estimatedCostUsd: FRONT_LOAD_USD,
    requestSummary: summary,
    run: () => provider.transcribe(parsed.data),
  });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
