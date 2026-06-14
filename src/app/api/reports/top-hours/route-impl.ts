/**
 * GET /api/reports/top-hours — 24-bucket plays-per-hour, zero-filled.
 *
 * Mirrors `functions/api/reports/top-hours.ts`. The DB returns up to 24 rows
 * — one per hour with data — and we expand to a deterministic 0..23 here so
 * the chart never has to.
 */

import { z } from 'zod';

import { getDb, type DbClient } from '@/db/client';
import { jsonError, jsonOk, methodNotAllowed } from '@/server/api-response';
import { requireStation } from '@/server/auth/require-station';
import { logAndScrub } from '@/server/internal-error';
import {
  queryTopHours,
  type TopHourRow,
} from '@/server/queries/report-queries';

interface TopHoursDeps {
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

/**
 * Zero-fill the SQL result so the chart always renders 24 buckets. Hours from
 * the DB come in as zero-padded strings ("00".."23") because we used
 * `substring(played_at, 12, 2)`.
 */
function zeroFillHours(rows: TopHourRow[]): { hour: number; plays: number }[] {
  const map = new Map<number, number>();
  for (const r of rows) {
    const h = Number.parseInt(r.hour, 10);
    if (Number.isFinite(h) && h >= 0 && h < 24) {
      map.set(h, r.plays);
    }
  }
  const buckets: { hour: number; plays: number }[] = [];
  for (let h = 0; h < 24; h += 1) {
    buckets.push({ hour: h, plays: map.get(h) ?? 0 });
  }
  return buckets;
}

export async function getReportsTopHours(
  request: Request,
  deps: TopHoursDeps = {},
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
    const rows = await queryTopHours(db, gate.context.stationId, { from, to });
    return jsonOk({
      hours: zeroFillHours(rows),
      range: { from: from ?? null, to: to ?? null },
    });
  } catch (err) {
    return jsonError(500, logAndScrub(err, { tag: 'reports/top-hours' }));
  }
}

export async function GET(request: Request): Promise<Response> {
  return getReportsTopHours(request);
}

export async function POST(): Promise<Response> {
  return methodNotAllowed(['GET']);
}
