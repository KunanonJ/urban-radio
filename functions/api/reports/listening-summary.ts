/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import {
  buildOverviewQuery,
  buildSourceBreakdownQuery,
} from '../../_lib/report-queries';

type Ctx = { env: SonicBloomEnv; request: Request };

interface OverviewRow {
  totalPlays: number | null;
  uniqueTitles: number | null;
  daysWithActivity: number | null;
  totalListeningHours: number | null;
}

interface SourceRow {
  source: string;
  plays: number;
}

function jsonError(status: number, message: string, details?: unknown): Response {
  const body: Record<string, unknown> = { error: message };
  if (details !== undefined) body.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
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

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  });
  if (!parsed.success) {
    return jsonError(400, 'Invalid query parameters', parsed.error.flatten());
  }

  const { from, to } = parsed.data;

  try {
    const overviewQ = buildOverviewQuery(gate.context.stationId, { from, to });
    const breakdownQ = buildSourceBreakdownQuery(gate.context.stationId, { from, to });

    const [overviewRes, breakdownRes] = await Promise.all([
      db
        .prepare(overviewQ.sql)
        .bind(...overviewQ.params)
        .all<OverviewRow>(),
      db
        .prepare(breakdownQ.sql)
        .bind(...breakdownQ.params)
        .all<SourceRow>(),
    ]);

    const overviewRow = (overviewRes.results ?? [])[0] ?? {
      totalPlays: 0,
      uniqueTitles: 0,
      daysWithActivity: 0,
      totalListeningHours: 0,
    };

    return Response.json({
      summary: {
        totalPlays: overviewRow.totalPlays ?? 0,
        totalListeningHours: overviewRow.totalListeningHours ?? 0,
        sourceBreakdown: (breakdownRes.results ?? []).map((r) => ({
          source: r.source,
          plays: r.plays,
        })),
      },
      range: { from: from ?? null, to: to ?? null },
    });
  } catch (err) {
    console.error('reports/listening-summary', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
