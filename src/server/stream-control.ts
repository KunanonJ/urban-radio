/**
 * Stream control adapter — Next-side port of `functions/_lib/stream-control.ts`.
 *
 * Same contract, same stub behaviour. The module-level state map is process-
 * local; for the dual-stack migration that's fine because the Cloudflare
 * deployment continues to be the source of truth for live audio. The Next
 * routes only consume `status()` for the public status page.
 *
 * Keep this file in lockstep with the legacy one. Cross-stack divergence
 * would silently surface as inconsistent encoder data between deployments.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

export interface StreamStatus {
  connected: boolean;
  mountPoint: string | null;
  listeners: number;
  bitrate: number | null;
  uptimeSeconds: number;
  source: 'azuracast' | 'stub' | 'fly-liquidsoap';
}

export interface StreamMetadata {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
}

export type StreamControlResult =
  | { ok: true }
  | { ok: false; error: string };

export interface StreamControlAdapter {
  start(stationId: string): Promise<StreamControlResult>;
  stop(stationId: string): Promise<StreamControlResult>;
  updateMetadata(
    stationId: string,
    meta: StreamMetadata,
  ): Promise<StreamControlResult>;
  status(stationId: string): Promise<StreamStatus>;
}

interface StubStationState {
  connected: boolean;
  startedAtMs: number | null;
  lastMetadata: StreamMetadata | null;
}

const STUB_STATE: Map<string, StubStationState> = new Map();

function nowMs(opts?: { now?: number }): number {
  return opts?.now ?? Date.now();
}

function defaultState(): StubStationState {
  return { connected: false, startedAtMs: null, lastMetadata: null };
}

export class StubStreamControl implements StreamControlAdapter {
  async start(
    stationId: string,
    opts?: { now?: number },
  ): Promise<StreamControlResult> {
    const existing = STUB_STATE.get(stationId) ?? defaultState();
    if (existing.connected) return { ok: true };
    STUB_STATE.set(stationId, {
      ...existing,
      connected: true,
      startedAtMs: nowMs(opts),
    });
    return { ok: true };
  }

  async stop(stationId: string): Promise<StreamControlResult> {
    const existing = STUB_STATE.get(stationId) ?? defaultState();
    STUB_STATE.set(stationId, {
      ...existing,
      connected: false,
      startedAtMs: null,
    });
    return { ok: true };
  }

  async updateMetadata(
    stationId: string,
    meta: StreamMetadata,
  ): Promise<StreamControlResult> {
    const existing = STUB_STATE.get(stationId) ?? defaultState();
    STUB_STATE.set(stationId, {
      ...existing,
      lastMetadata: { ...meta },
    });
    return { ok: true };
  }

  async status(
    stationId: string,
    opts?: { now?: number },
  ): Promise<StreamStatus> {
    const s = STUB_STATE.get(stationId) ?? defaultState();
    const uptimeSeconds =
      s.connected && s.startedAtMs !== null
        ? Math.max(0, Math.floor((nowMs(opts) - s.startedAtMs) / 1000))
        : 0;
    return {
      connected: s.connected,
      mountPoint: s.connected ? `/stub/${stationId}` : null,
      listeners: 0,
      bitrate: s.connected ? 128 : null,
      uptimeSeconds,
      source: 'stub',
    };
  }

  snapshot(stationId: string): StubStationState {
    return STUB_STATE.get(stationId) ?? defaultState();
  }
}

export function getStreamControl(env: {
  STREAM_CONTROL_URL?: string;
  STREAM_CONTROL_KEY?: string;
}): StreamControlAdapter {
  void env.STREAM_CONTROL_URL;
  void env.STREAM_CONTROL_KEY;
  return new StubStreamControl();
}

export function __resetStubStreamControlForTests(): void {
  STUB_STATE.clear();
}

export const SCHEMA_VERSION = 3;
