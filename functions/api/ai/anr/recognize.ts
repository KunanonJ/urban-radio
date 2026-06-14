/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import { createAnrProvider } from '@/lib/ai';
import { runAiCapability } from '../../../_lib/ai-bridge';
import type { SonicBloomEnv } from '../../../_lib/env';
import { requireStation } from '../../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

/** AudD is ~$0.001/request; front-load $0.003 to cover three sample retries. */
const FRONT_LOAD_USD = 0.003;

const recognizeSchema = z
  .object({
    audioBase64: z.string().min(1).optional(),
    audioUrl: z.string().url().optional(),
    windowSeconds: z.number().int().positive().max(300).optional(),
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
  const parsed = recognizeSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const provider = createAnrProvider({
    AUDD_API_KEY: (ctx.env as { AUDD_API_KEY?: string }).AUDD_API_KEY,
    ACR_CLOUD_KEY: (ctx.env as { ACR_CLOUD_KEY?: string }).ACR_CLOUD_KEY,
    ACR_CLOUD_SECRET: (ctx.env as { ACR_CLOUD_SECRET?: string }).ACR_CLOUD_SECRET,
  });

  const summary = parsed.data.audioUrl ?? `inline-audio-${parsed.data.audioBase64?.length ?? 0}b`;

  return runAiCapability(ctx.env, gate, {
    capability: 'anr',
    estimatedCostUsd: FRONT_LOAD_USD,
    requestSummary: summary,
    run: () => provider.recognize(parsed.data),
  });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
