/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { requireStation } from '../../_lib/require-station';
import { writeAuditLog } from '../../_lib/audit-log';
import { getStreamControl } from '../../_lib/stream-control';

type Ctx = { env: SonicBloomEnv; request: Request };

const ALLOWED_ROLES = new Set(['admin', 'producer']);

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const gate = await requireStation(ctx.env, ctx.request);
  if (!gate.ok) return gate.response;

  if (!ALLOWED_ROLES.has(gate.context.role)) {
    return jsonError(403, 'Insufficient role for stream control');
  }

  const db = ctx.env.DB!;
  const adapter = getStreamControl(ctx.env as unknown as {
    STREAM_CONTROL_URL?: string;
    STREAM_CONTROL_KEY?: string;
  });

  let result: { ok: true } | { ok: false; error: string };
  try {
    result = await adapter.start(gate.context.stationId);
  } catch (err) {
    console.error('stream/start adapter', err);
    return jsonError(500, err instanceof Error ? err.message : 'start failed');
  }

  if (!result.ok) {
    return new Response(JSON.stringify({ ok: false, error: result.error }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const status = await adapter.status(gate.context.stationId);

  await writeAuditLog(db, {
    stationId: gate.context.stationId,
    actorUserId: gate.context.userId,
    action: 'stream_start',
    targetType: 'station',
    targetId: gate.context.stationId,
    after: { connected: status.connected, source: status.source },
  });

  return Response.json({ ok: true, status });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
