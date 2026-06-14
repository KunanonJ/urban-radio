/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { getStreamControl } from '../../_lib/stream-control';

type Ctx = { env: SonicBloomEnv; request: Request };

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;

  try {
    const adapter = getStreamControl(ctx.env as unknown as {
      STREAM_CONTROL_URL?: string;
      STREAM_CONTROL_KEY?: string;
    });
    const status = await adapter.status(gate.context.stationId);
    return Response.json({ status });
  } catch (err) {
    console.error('stream/status', err);
    return jsonError(500, err instanceof Error ? err.message : 'status failed');
  }
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
