/**
 * POST /api/ai/anr/recognize — audio fingerprint match → track metadata.
 *
 * Mirrors `functions/api/ai/anr/recognize.ts`. Auth + cost-guard + ai_usage
 * persistence via `runAiCapability`.
 *
 * AudD is ~$0.001/request; front-load $0.003 to cover three sample retries.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β7.
 */

import { z } from 'zod';

import type { DbClient } from '@/db/client';
import { getDb } from '@/db/client';
import type { AnrProvider } from '@/lib/ai';
import { runAiCapability } from '@/server/ai/bridge';
import { getAnrProvider } from '@/server/ai/providers';
import { checkAudioUrl } from '@/server/ai/url-allowlist';
import { jsonError } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import {
  defaultRateLimiter,
  AI_PER_STATION_LIMIT,
  rateLimitedResponse,
  type RateLimiter,
} from '@/server/rate-limit';

const FRONT_LOAD_USD = 0.003;

/**
 * Pentest M-10: cap base64 audio at ~10 MB raw (≈13.4 M chars). Without
 * the cap an authenticated attacker could ship arbitrarily large bodies
 * and burn provider budget faster than the rate limiter can stop them.
 * Same cap as voice-tracks upload-helpers.ts.
 */
const MAX_AUDIO_BASE64_CHARS = (10 * 1024 * 1024 * 4) / 3 + 100;

const recognizeSchema = z
  .object({
    audioBase64: z.string().min(1).max(MAX_AUDIO_BASE64_CHARS).optional(),
    audioUrl: z.string().url().optional(),
    windowSeconds: z.number().int().positive().max(300).optional(),
  })
  .refine((v) => v.audioBase64 || v.audioUrl, {
    message: 'audioBase64 or audioUrl is required',
  });

export interface AnrRecognizeDeps {
  db?: DbClient;
  secret?: string;
  anrProvider?: AnrProvider;
  usageId?: string;
  /** Injected in tests to control rate-limit state independently. */
  rateLimiter?: RateLimiter;
}

export async function postAnrRecognize(
  request: Request,
  deps: AnrRecognizeDeps = {},
): Promise<Response> {
  const db = deps.db ?? getDb();
  const gate = await requireStation(request, { db, secret: deps.secret });
  if (!gate.ok) return gate.response;

  // Pentest H-09: per-station rate limit BEFORE opening a SERIALIZABLE tx.
  const limiter = deps.rateLimiter ?? defaultRateLimiter;
  const stationKey = `ai:anr:${gate.context.stationId}`;
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
  const parsed = recognizeSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  // Pentest M-13: SSRF defense — validate audioUrl before it reaches any
  // server-side fetch call (AudD, ACRCloud providers will fetch the URL).
  if (parsed.data.audioUrl) {
    const allow = checkAudioUrl(parsed.data.audioUrl);
    if (!allow.ok) {
      return jsonError(400, 'audioUrl rejected', { reason: allow.reason });
    }
  }

  const provider = deps.anrProvider ?? getAnrProvider();
  const summary =
    parsed.data.audioUrl ??
    `inline-audio-${parsed.data.audioBase64?.length ?? 0}b`;

  return runAiCapability(
    { db, usageId: deps.usageId },
    gate,
    {
      capability: 'anr',
      estimatedCostUsd: FRONT_LOAD_USD,
      requestSummary: summary,
      run: () => provider.recognize(parsed.data),
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  return postAnrRecognize(request, { db: getDb() });
}
