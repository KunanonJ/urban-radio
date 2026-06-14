/**
 * POST /api/ai/voice/synthesize — TTS via the configured voice provider.
 *
 * Mirrors `functions/api/ai/voice/synthesize.ts`. Auth + cost-guard + ai_usage
 * persistence via the shared `runAiCapability` bridge.
 *
 * Front-load $0.01 (~33 chars at stub $0.0003/char). Real ElevenLabs synthesis
 * of a typical 250-char DJ line is ~$0.075, so the guard mostly protects
 * runaway plan-cap edges.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β7.
 */

import { z } from 'zod';

import type { DbClient } from '@/db/client';
import { getDb } from '@/db/client';
import type { VoiceProvider } from '@/lib/ai';
import { runAiCapability } from '@/server/ai/bridge';
import { getVoiceProvider } from '@/server/ai/providers';
import { jsonError } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import {
  defaultRateLimiter,
  AI_PER_STATION_LIMIT,
  rateLimitedResponse,
  type RateLimiter,
} from '@/server/rate-limit';

const FRONT_LOAD_USD = 0.01;

const synthesizeSchema = z.object({
  text: z.string().trim().min(1, 'text is required').max(5000),
  voiceId: z.string().trim().min(1, 'voiceId is required').max(120),
  format: z.enum(['mp3', 'wav', 'pcm']).optional(),
  stability: z.number().min(0).max(1).optional(),
  similarity: z.number().min(0).max(1).optional(),
  style: z.number().min(0).max(1).optional(),
});

export interface VoiceSynthesizeDeps {
  db?: DbClient;
  secret?: string;
  voiceProvider?: VoiceProvider;
  usageId?: string;
  /** Injected in tests to control rate-limit state independently. */
  rateLimiter?: RateLimiter;
}

export async function postVoiceSynthesize(
  request: Request,
  deps: VoiceSynthesizeDeps = {},
): Promise<Response> {
  const db = deps.db ?? getDb();
  const gate = await requireStation(request, { db, secret: deps.secret });
  if (!gate.ok) return gate.response;

  // Pentest H-09: per-station rate limit BEFORE opening a SERIALIZABLE tx.
  const limiter = deps.rateLimiter ?? defaultRateLimiter;
  const stationKey = `ai:voice:${gate.context.stationId}`;
  const rlResult = limiter.consume(stationKey, AI_PER_STATION_LIMIT);
  if (!rlResult.allowed) {
    return rateLimitedResponse(rlResult.retryAfterSec);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON');
  }
  const parsed = synthesizeSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const provider = deps.voiceProvider ?? getVoiceProvider();

  return runAiCapability(
    { db, usageId: deps.usageId },
    gate,
    {
      capability: 'voice',
      estimatedCostUsd: FRONT_LOAD_USD,
      requestSummary: parsed.data.text,
      run: () => provider.synthesize(parsed.data),
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  return postVoiceSynthesize(request, { db: getDb() });
}
