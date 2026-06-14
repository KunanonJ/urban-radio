/**
 * GET /api/reports/overview — headline numbers for the Reports landing card.
 *
 * Mirrors `functions/api/reports/overview.ts`. Read-only, station-scoped via
 * `requireStation`. Reports are aggregations against `play_log`, so no audit
 * row is written.
 *
 * Query params: `from`, `to` (ISO 8601). Both optional, both validated.
 */

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import { queryOverview } from '@/server/queries/report-queries';

interface OverviewDeps {
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
});

export async function getReportsOverview(
  request: Request,
  deps: OverviewDeps = {},
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
  });
  if (!parsed.success) {
    return jsonError(400, 'Invalid query parameters', parsed.error.flatten());
  }

  const { from, to } = parsed.data;

  try {
    const db = deps.db ?? getDb();
    const row = await queryOverview(db, gate.context.stationId, { from, to });
    return jsonOk({
      overview: {
        totalPlays: row.totalPlays,
        uniqueTitles: row.uniqueTitles,
        daysWithActivity: row.daysWithActivity,
        totalListeningHours: row.totalListeningHours,
      },
      range: { from: from ?? null, to: to ?? null },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'reports/overview' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return getReportsOverview(request);
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
