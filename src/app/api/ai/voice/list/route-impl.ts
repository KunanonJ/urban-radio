/**
 * GET /api/ai/voice/list — voice library (stock + cloned).
 *
 * Mirrors `functions/api/ai/voice/list.ts`. Read-only, no cost-guard
 * because stock + cloned voices are cheap metadata lookups. Auth still
 * required so unauthenticated users can't enumerate the catalog.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β7.
 */

import { z } from 'zod';

import type { DbClient } from '@/db/client';
import { getDb } from '@/db/client';
import type { VoiceProvider } from '@/lib/ai';
import { jsonError } from '@/server/api-response';
import { getVoiceProvider } from '@/server/ai/providers';
import { requireStation } from '@/server/auth/require-station';
import {
  defaultRateLimiter,
  AI_PER_STATION_LIMIT,
  rateLimitedResponse,
  type RateLimiter,
} from '@/server/rate-limit';

const querySchema = z.object({
  scope: z.enum(['cloned', 'stock', 'all']).optional(),
});

export interface VoiceListDeps {
  db?: DbClient;
  secret?: string;
  voiceProvider?: VoiceProvider;
  /** Injected in tests to control rate-limit state independently. */
  rateLimiter?: RateLimiter;
}

export async function getVoiceList(
  request: Request,
  deps: VoiceListDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  // Pentest H-09: per-station rate limit on the metadata list endpoint.
  const limiter = deps.rateLimiter ?? defaultRateLimiter;
  const stationKey = `ai:voice:${gate.context.stationId}`;
  const rlResult = limiter.consume(stationKey, AI_PER_STATION_LIMIT);
  if (!rlResult.allowed) {
    return rateLimitedResponse(rlResult.retryAfterSec);
  }

  const url = new URL(request.url);
  const scopeRaw = url.searchParams.get('scope') ?? undefined;
  const parsed = querySchema.safeParse({ scope: scopeRaw });
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const provider = deps.voiceProvider ?? getVoiceProvider();
  const result = await provider.listVoices({ scope: parsed.data.scope });

  if (!result.ok) {
    // Pentest M-14: don't forward the provider's raw error string —
    // it sometimes leaks endpoint paths / key fragments. Log + scrub.
    // eslint-disable-next-line no-console
    console.error('voice/list: provider returned error', {
      provider: result.provider,
      error: result.error,
    });
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Provider failure',
        provider: result.provider,
      }),
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

export async function GET(request: Request): Promise<Response> {
  return getVoiceList(request, { db: getDb() });
}
