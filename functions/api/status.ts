/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../_lib/env';
import { getStreamControl, type StreamStatus } from '../_lib/stream-control';

type Ctx = { env: SonicBloomEnv; request: Request };

interface StatusResponse {
  ok: boolean;
  ts: number;
  encoder: {
    connected: boolean;
    source: StreamStatus['source'];
    listeners: number;
    bitrate: number | null;
    uptimeSeconds: number;
    mountPoint: string | null;
  };
  scheduler: {
    lastHeartbeatAt: string | null;
  };
  lastBroadcastAt: string | null;
}

const PROBE_STATION_ID = '__default__';

async function queryLastHeartbeat(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare(
        `SELECT at FROM audit_log
         WHERE action LIKE 'scheduler_%'
         ORDER BY at DESC
         LIMIT 1`,
      )
      .first<{ at: string }>();
    return row?.at ?? null;
  } catch (err) {
    console.error('[status] heartbeat query failed', err);
    return null;
  }
}

async function queryLastBroadcast(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare(
        `SELECT played_at FROM play_log
         ORDER BY played_at DESC
         LIMIT 1`,
      )
      .first<{ played_at: string }>();
    return row?.played_at ?? null;
  } catch (err) {
    console.error('[status] last-broadcast query failed', err);
    return null;
  }
}

/**
 * Phase 8 — public status snapshot for a public status page or operator dashboard.
 *
 * Aggregates:
 *   - encoder status from the stream-control adapter (stub today, AzuraCast later)
 *   - scheduler heartbeat (latest `audit_log` row with action LIKE 'scheduler_%')
 *   - last broadcast timestamp (latest `play_log` row)
 *
 * No auth required — declared public in `require-session.isPublicApiRoute`.
 * Failures degrade gracefully to nulls rather than 5xx so the page stays useful.
 */
export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { env } = ctx;
  const adapter = getStreamControl(
    env as unknown as { STREAM_CONTROL_URL?: string; STREAM_CONTROL_KEY?: string },
  );

  // Encoder status — the adapter is the source of truth.
  let encoderStatus: StreamStatus;
  try {
    encoderStatus = await adapter.status(PROBE_STATION_ID);
  } catch (err) {
    console.error('[status] adapter.status failed', err);
    encoderStatus = {
      connected: false,
      mountPoint: null,
      listeners: 0,
      bitrate: null,
      uptimeSeconds: 0,
      source: 'stub',
    };
  }

  // DB-backed signals — degrade to null on any error.
  const [lastHeartbeatAt, lastBroadcastAt] = env.DB
    ? await Promise.all([queryLastHeartbeat(env.DB), queryLastBroadcast(env.DB)])
    : [null, null];

  const body: StatusResponse = {
    ok: true,
    ts: Date.now(),
    encoder: {
      connected: encoderStatus.connected,
      source: encoderStatus.source,
      listeners: encoderStatus.listeners,
      bitrate: encoderStatus.bitrate,
      uptimeSeconds: encoderStatus.uptimeSeconds,
      mountPoint: encoderStatus.mountPoint,
    },
    scheduler: {
      lastHeartbeatAt,
    },
    lastBroadcastAt,
  };

  return Response.json(body, { status: 200 });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'GET') return onRequestGet(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
