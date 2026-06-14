/**
 * POST /api/ai/text/generate — short DJ/script copy via the text provider.
 *
 * Mirrors `functions/api/ai/text/generate.ts`. Auth + cost-guard + ai_usage
 * persistence via `runAiCapability`.
 *
 * Stub Anthropic Haiku tokens are tiny; front-load $0.005 to keep callers honest.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β7.
 */

import { z } from 'zod';

import type { DbClient } from '@/db/client';
import { getDb } from '@/db/client';
import type { TextProvider } from '@/lib/ai';
import { runAiCapability } from '@/server/ai/bridge';
import { getTextProvider } from '@/server/ai/providers';
import { jsonError } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import {
  defaultRateLimiter,
  AI_PER_STATION_LIMIT,
  rateLimitedResponse,
  type RateLimiter,
} from '@/server/rate-limit';

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

export interface TextGenerateDeps {
  db?: DbClient;
  secret?: string;
  textProvider?: TextProvider;
  usageId?: string;
  /** Injected in tests to control rate-limit state independently. */
  rateLimiter?: RateLimiter;
}

export async function postTextGenerate(
  request: Request,
  deps: TextGenerateDeps = {},
): Promise<Response> {
  const db = deps.db ?? getDb();
  const gate = await requireStation(request, { db, secret: deps.secret });
  if (!gate.ok) return gate.response;

  // Pentest H-09: per-station rate limit BEFORE opening a SERIALIZABLE tx.
  const limiter = deps.rateLimiter ?? defaultRateLimiter;
  const stationKey = `ai:text:${gate.context.stationId}`;
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
  const parsed = generateSchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError(400, 'Validation failed', parsed.error.flatten());
  }

  const provider = deps.textProvider ?? getTextProvider();

  /** request_summary is a short label of the request topic for audit grepability. */
  const summary = `${parsed.data.topic}${
    parsed.data.context?.title ? `: ${parsed.data.context.title}` : ''
  }`;

  return runAiCapability(
    { db, usageId: deps.usageId },
    gate,
    {
      capability: 'text',
      estimatedCostUsd: FRONT_LOAD_USD,
      requestSummary: summary,
      run: () => provider.generate(parsed.data),
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  return postTextGenerate(request, { db: getDb() });
}
