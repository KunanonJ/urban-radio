/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import { createVoiceProvider } from '@/lib/ai';
import type { SonicBloomEnv } from '../../../_lib/env';
import { requireStation } from '../../../_lib/require-station';

type Ctx = { env: SonicBloomEnv; request: Request };

/**
 * Voice library listing — read-only, no cost-guard (stock + cloned voices are
 * cheap metadata lookups). Auth still required so unauthenticated users can't
 * enumerate the available voices.
 */
const querySchema = z.object({
  scope: z.enum(['cloned', 'stock', 'all']).optional(),
});

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;

  const url = new URL(ctx.request.url);
  const scopeRaw = url.searchParams.get('scope') ?? undefined;
  const parsed = querySchema.safeParse({ scope: scopeRaw });
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const provider = createVoiceProvider({
    ELEVENLABS_API_KEY: (ctx.env as { ELEVENLABS_API_KEY?: string }).ELEVENLABS_API_KEY,
    OPENAI_API_KEY: (ctx.env as { OPENAI_API_KEY?: string }).OPENAI_API_KEY,
  });

  const result = await provider.listVoices({ scope: parsed.data.scope });
  if (!result.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: result.error, provider: result.provider }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      data: result.data,
      usage: result.usage,
      provider: result.provider,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    },
  );
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
