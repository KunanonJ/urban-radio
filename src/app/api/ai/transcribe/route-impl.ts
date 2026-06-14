/**
 * POST /api/ai/transcribe — audio → text via the configured transcribe provider.
 *
 * Mirrors `functions/api/ai/transcribe.ts`. Auth + cost-guard + ai_usage
 * persistence via `runAiCapability`.
 *
 * Deepgram Nova-2 is ~$0.0043/min; front-load $0.01 (~2 min budget) per request.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β7.
 */

import { z } from 'zod';

import type { DbClient } from '@/db/client';
import { getDb } from '@/db/client';
import type { TranscribeProvider } from '@/lib/ai';
import { runAiCapability } from '@/server/ai/bridge';
import { getTranscribeProvider } from '@/server/ai/providers';
import { checkAudioUrl } from '@/server/ai/url-allowlist';
import { jsonError } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import {
  defaultRateLimiter,
  AI_PER_STATION_LIMIT,
  rateLimitedResponse,
  type RateLimiter,
} from '@/server/rate-limit';

const FRONT_LOAD_USD = 0.01;

/**
 * Pentest M-10: cap base64 audio at ~10 MB raw. See recognize/route-impl.ts.
 */
const MAX_AUDIO_BASE64_CHARS = (10 * 1024 * 1024 * 4) / 3 + 100;

const transcribeSchema = z
  .object({
    audioBase64: z.string().min(1).max(MAX_AUDIO_BASE64_CHARS).optional(),
    audioUrl: z.string().url().optional(),
    language: z.string().min(2).max(8).optional(),
    live: z.boolean().optional(),
  })
  .refine((v) => v.audioBase64 || v.audioUrl, {
    message: 'audioBase64 or audioUrl is required',
  });

export interface TranscribeDeps {
  db?: DbClient;
  secret?: string;
  transcribeProvider?: TranscribeProvider;
  usageId?: string;
  /** Injected in tests to control rate-limit state independently. */
  rateLimiter?: RateLimiter;
}

export async function postTranscribe(
  request: Request,
  deps: TranscribeDeps = {},
): Promise<Response> {
  const db = deps.db ?? getDb();
  const gate = await requireStation(request, { db, secret: deps.secret });
  if (!gate.ok) return gate.response;

  // Pentest H-09: per-station rate limit BEFORE opening a SERIALIZABLE tx.
  const limiter = deps.rateLimiter ?? defaultRateLimiter;
  const stationKey = `ai:transcribe:${gate.context.stationId}`;
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
  const parsed = transcribeSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  // Pentest M-13: SSRF defense — validate audioUrl before it reaches any
  // server-side fetch call (Deepgram, AssemblyAI providers will fetch the URL).
  if (parsed.data.audioUrl) {
    const allow = checkAudioUrl(parsed.data.audioUrl);
    if (!allow.ok) {
      return jsonError(400, 'audioUrl rejected', { reason: allow.reason });
    }
  }

  const provider = deps.transcribeProvider ?? getTranscribeProvider();
  const summary =
    parsed.data.audioUrl ??
    `inline-audio-${parsed.data.audioBase64?.length ?? 0}b`;

  return runAiCapability(
    { db, usageId: deps.usageId },
    gate,
    {
      capability: 'transcribe',
      estimatedCostUsd: FRONT_LOAD_USD,
      requestSummary: summary,
      run: () => provider.transcribe(parsed.data),
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  return postTranscribe(request, { db: getDb() });
}
