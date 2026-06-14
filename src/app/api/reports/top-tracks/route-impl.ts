/**
 * GET /api/reports/top-tracks — top N (title, artist) by play count.
 *
 * Mirrors `functions/api/reports/top-tracks.ts`. `limit` is clamped server-side
 * and reflected back in the response so the UI can render pagination state.
 */

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  ALLOWED_SOURCES,
  type PlayLogSource,
} from '@/server/queries/play-log-queries';
import {
  clampLimit,
  queryTopTracks,
  REPORT_DEFAULT_TOP_LIMIT,
  REPORT_MAX_TOP_LIMIT,
} from '@/server/queries/report-queries';

interface TopTracksDeps {
  db?: DbClient;
  secret?: string;
}

const isoString = z
  .string()
  .trim()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid ISO date' });

const querySchema = z.object({
  from: isoString.optional(),
  to: isoString.optional(),
  limit: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : Number(v)))
    .refine(
      (v) => v === undefined || (!Number.isNaN(v) && Number.isFinite(v)),
      { message: 'limit must be a finite number' },
    ),
  source: z
    .enum(ALLOWED_SOURCES as unknown as [PlayLogSource, ...PlayLogSource[]])
    .optional(),
});

export async function getReportsTopTracks(
  request: Request,
  deps: TopTracksDeps = {},
): Promise<Response> {
  const gate = await requireStation(request, {
    db: deps.db,
    secret: deps.secret,
  });
  if (!gate.ok) return gate.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, 'Invalid query parameters', parsed.error.flatten());
  }

  const { from, to, source } = parsed.data;
  const limit = clampLimit(
    parsed.data.limit,
    REPORT_MAX_TOP_LIMIT,
    REPORT_DEFAULT_TOP_LIMIT,
  );

  try {
    const db = deps.db ?? getDb();
    const { tracks } = await queryTopTracks(
      db,
      gate.context.stationId,
      { from, to },
      { limit, source },
    );
    return jsonOk({
      tracks,
      limit,
      range: { from: from ?? null, to: to ?? null },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'reports/top-tracks' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return getReportsTopTracks(request);
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
