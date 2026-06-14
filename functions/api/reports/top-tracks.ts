/// <reference types="@cloudflare/workers-types" />

import { z } from 'zod';
import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import {
  buildTopTracksQuery,
  clampLimit,
  REPORT_DEFAULT_TOP_LIMIT,
  REPORT_MAX_TOP_LIMIT,
} from '../../_lib/report-queries';
import { ALLOWED_SOURCES, type PlayLogSource } from '../../_lib/play-log-queries';

type Ctx = { env: SonicBloomEnv; request: Request };

interface TopTrackRow {
  title_snapshot: string;
  artist_snapshot: string | null;
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
  limit: z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? undefined : Number(v)))
    .refine((v) => v === undefined || (!Number.isNaN(v) && Number.isFinite(v)), {
      message: 'limit must be a finite number',
    }),
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
    const { sql, params } = buildTopTracksQuery(
      gate.context.stationId,
      { from, to },
      { limit, source },
    );
    const { results } = await db
      .prepare(sql)
      .bind(...params)
      .all<TopTrackRow>();
    const tracks = (results ?? []).map((r) => ({
      title: r.title_snapshot,
      artist: r.artist_snapshot,
      plays: r.plays,
    }));
    return Response.json({
      tracks,
      limit,
      range: { from: from ?? null, to: to ?? null },
    });
  } catch (err) {
    console.error('reports/top-tracks', err);
    return jsonError(500, err instanceof Error ? err.message : 'query failed');
  }
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
