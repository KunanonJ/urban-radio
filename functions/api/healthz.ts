/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../_lib/env';

type Ctx = { env: SonicBloomEnv; request: Request };

interface HealthzResponse {
  ok: boolean;
  ts: number;
  db?: 'connected' | 'unavailable' | 'error';
}

/**
 * Phase 8 — public health check for uptime monitors (Better Stack, UptimeRobot, etc).
 *
 * - No auth required (declared public in `require-session.isPublicApiRoute`).
 * - Default: bare `{ ok: true, ts }` — fast, ~1ms, no I/O.
 * - With `?probe=db`: pings D1 with `SELECT 1`. Returns 503 if the DB binding
 *   is missing or the query throws. Use sparingly — every probe is a CPU-time hit.
 *
 * Differs from `/api/health` (which reports schema version + counts and is more
 * thorough but slightly slower). Both are public; `/api/healthz` is the
 * preferred uptime-check target.
 */
export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const url = new URL(request.url);
  const probe = url.searchParams.get('probe');

  const ts = Date.now();

  if (probe !== 'db') {
    const body: HealthzResponse = { ok: true, ts };
    return Response.json(body, { status: 200 });
  }

  // Probe mode: actively check the DB connection.
  if (!env.DB) {
    const body: HealthzResponse = { ok: false, ts, db: 'unavailable' };
    return Response.json(body, { status: 503 });
  }

  try {
    await env.DB.prepare('SELECT 1').first();
    const body: HealthzResponse = { ok: true, ts, db: 'connected' };
    return Response.json(body, { status: 200 });
  } catch (err) {
    console.error('[healthz] DB probe failed', err);
    const body: HealthzResponse = { ok: false, ts, db: 'error' };
    return Response.json(body, { status: 503 });
  }
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
