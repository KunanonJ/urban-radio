/**
 * GET /api/reports/plays-by-day — plays per day, ascending, optionally
 * filtered by `source`. Mirrors `functions/api/reports/plays-by-day.ts`.
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
import { queryPlaysByDay } from '@/server/queries/report-queries';

interface PlaysByDayDeps {
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
  source: z
    .enum(ALLOWED_SOURCES as unknown as [PlayLogSource, ...PlayLogSource[]])
    .optional(),
});

export async function getReportsPlaysByDay(
  request: Request,
  deps: PlaysByDayDeps = {},
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
    source: url.searchParams.get('source') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, 'Invalid query parameters', parsed.error.flatten());
  }

  const { from, to, source } = parsed.data;

  try {
    const db = deps.db ?? getDb();
    const days = await queryPlaysByDay(
      db,
      gate.context.stationId,
      { from, to },
      { source },
    );
    return jsonOk({
      days: days.map((r) => ({ day: r.day, plays: r.plays })),
      range: { from: from ?? null, to: to ?? null },
      source: source ?? null,
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'reports/plays-by-day' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return getReportsPlaysByDay(request);
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
