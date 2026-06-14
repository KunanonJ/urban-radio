/// <reference types="@cloudflare/workers-types" />

import { SCHEMA_VERSION, type SonicBloomEnv } from '../_lib/env';

type Ctx = { env: SonicBloomEnv; request: Request };

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  let dbOk = false;
  let trackCount = 0;
  try {
    if (env.DB) {
      await env.DB.prepare('SELECT 1').first();
      dbOk = true;
      const row = await env.DB.prepare('SELECT COUNT(*) as c FROM tracks').first<{ c: number }>();
      trackCount = row?.c ?? 0;
    }
  } catch {
    dbOk = false;
  }

  const r2Ok = Boolean(env.MEDIA_BUCKET);

  return Response.json({
    ok: true,
    service: 'sonic-bloom',
    time: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    db: dbOk ? 'connected' : 'unavailable',
    trackCount,
    r2: r2Ok ? 'bound' : 'unbound',
  });
}
