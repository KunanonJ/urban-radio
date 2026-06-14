/**
 * GET /api/reports/listening-summary — overview + source-mix in one envelope.
 *
 * Mirrors `functions/api/reports/listening-summary.ts`. Read-only,
 * station-scoped via `requireStation`. Runs the overview and source-breakdown
 * queries in parallel so the UI gets both halves in a single round-trip.
 */

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  queryOverview,
  querySourceBreakdown,
} from '@/server/queries/report-queries';

interface ListeningSummaryDeps {
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

export async function getReportsListeningSummary(
  request: Request,
  deps: ListeningSummaryDeps = {},
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
    const [overview, breakdown] = await Promise.all([
      queryOverview(db, gate.context.stationId, { from, to }),
      querySourceBreakdown(db, gate.context.stationId, { from, to }),
    ]);

    return jsonOk({
      summary: {
        totalPlays: overview.totalPlays,
        totalListeningHours: overview.totalListeningHours,
        sourceBreakdown: breakdown.map((r) => ({
          source: r.source,
          plays: r.plays,
        })),
      },
      range: { from: from ?? null, to: to ?? null },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'reports/listening-summary' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return getReportsListeningSummary(request);
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
