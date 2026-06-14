/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { buildPlaysByDayQuery } from '../../_lib/report-queries';
import { ALLOWED_SOURCES, type PlayLogSource } from '../../_lib/play-log-queries';

type Ctx = { env: SonicBloomEnv; request: Request };

interface DayRow {
  day: string;
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
  source: z
    .enum(ALLOWED_SOURCES as unknown as [PlayLogSource, ...PlayLogSource[]])
    .optional(),
});

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;
  const db = ctx.env.DB!;

  const url = new URL(ctx.request.url);
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
    const { sql, params } = buildPlaysByDayQuery(
      gate.context.stationId,
      { from, to },
      { source },
    );
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<DayRow>();
    const days = (results ?? []).map((r) => ({ day: r.day, plays: r.plays }));
    return Response.json({
      days,
      range: { from: from ?? null, to: to ?? null },
      source: source ?? null,
    });
  } catch (err) {
    console.error('reports/plays-by-day', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
