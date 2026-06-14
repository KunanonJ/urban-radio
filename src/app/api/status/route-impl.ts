/**
 * GET /api/status — public status page snapshot.
 *
 * Mirrors `functions/api/status.ts`. Aggregates encoder + scheduler heartbeat
 * + last broadcast time. Failures degrade gracefully to null so the public
 * status page stays useful even during partial outages.
 *
 * Public per `requireAppSession.isPublicApiRoute`.
 */

import { desc, like, sql } from 'drizzle-orm';

import { getDb, type DbClient } from '@/db/client';
import { auditLog, playLog } from '@/db/schema';
import { jsonOk } from '@/server/api-response';
import {
  getStreamControl,
  type StreamStatus,
} from '@/server/stream-control';

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

async function queryLastHeartbeat(db: DbClient): Promise<string | null> {
  try {
    const rows = await db
      .select({ at: auditLog.at })
      .from(auditLog)
      .where(like(auditLog.action, 'scheduler_%'))
      .orderBy(desc(auditLog.at))
      .limit(1);
    return rows[0]?.at ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[status] heartbeat query failed', err);
    return null;
  }
}

async function queryLastBroadcast(db: DbClient): Promise<string | null> {
  try {
    const rows = await db
      .select({ playedAt: playLog.playedAt })
      .from(playLog)
      .orderBy(desc(playLog.playedAt))
      .limit(1);
    return rows[0]?.playedAt ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[status] last-broadcast query failed', err);
    return null;
  }
}

interface StatusDeps {
  db?: DbClient;
  now?: number;
}

export async function getStatus(deps: StatusDeps = {}): Promise<Response> {
  const adapter = getStreamControl({
    STREAM_CONTROL_URL: process.env.STREAM_CONTROL_URL,
    STREAM_CONTROL_KEY: process.env.STREAM_CONTROL_KEY,
  });

  let encoderStatus: StreamStatus;
  try {
    encoderStatus = await adapter.status(PROBE_STATION_ID);
  } catch (err) {
    // eslint-disable-next-line no-console
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

  let lastHeartbeatAt: string | null = null;
  let lastBroadcastAt: string | null = null;
  try {
    const db = deps.db ?? getDb();
    // Touch the unused sql tag so import remains tree-shake stable.
    void sql;
    [lastHeartbeatAt, lastBroadcastAt] = await Promise.all([
      queryLastHeartbeat(db),
      queryLastBroadcast(db),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[status] db init failed', err);
  }

  const body: StatusResponse = {
    ok: true,
    ts: deps.now ?? Date.now(),
    encoder: {
      connected: encoderStatus.connected,
      source: encoderStatus.source,
      listeners: encoderStatus.listeners,
      bitrate: encoderStatus.bitrate,
      uptimeSeconds: encoderStatus.uptimeSeconds,
      mountPoint: encoderStatus.mountPoint,
    },
    scheduler: { lastHeartbeatAt },
    lastBroadcastAt,
  };

  return jsonOk(body);
}

export async function GET(): Promise<Response> {
  return getStatus();
}
