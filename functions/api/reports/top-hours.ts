/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { buildTopHoursQuery } from '../../_lib/report-queries';

type Ctx = { env: SonicBloomEnv; request: Request };

interface HourRow {
  hour: string;
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

/**
 * Zero-fill the SQL result so the chart always renders 24 buckets even when
 * some hours have no plays. Hours from the DB come in as zero-padded strings
 * ("00".."23") because strftime('%H', ...) returns text.
 */
function zeroFillHours(rows: HourRow[]): { hour: number; plays: number }[] {
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
    const { sql, params } = buildTopHoursQuery(gate.context.stationId, { from, to });
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<HourRow>();
    return Response.json({
      hours: zeroFillHours(results ?? []),
      range: { from: from ?? null, to: to ?? null },
    });
  } catch (err) {
    console.error('reports/top-hours', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
