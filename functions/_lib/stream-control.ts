/// <reference types="@cloudflare/workers-types" />

/**
 * Stream control adapter — Phase 3.
 *
 * This is the contract that the Live Studio screen will consume.
 *
 * - Today: `StubStreamControl` keeps per-station state in a module-level
 *   Map. There is no real streaming engine wired up yet.
 * - Future: when AzuraCast (or whatever streaming engine we land on) is
 *   reachable, we add an `AzuraCastAdapter implements StreamControlAdapter`
 *   and flip `getStreamControl(env)` to return it when the relevant env
 *   vars are set. The endpoints don't change — they only talk to the
 *   adapter interface.
 *
 * The stub is intentionally simple — it's just enough for the UI to be
 * built and the control flow to be tested end-to-end without a real
 * Icecast / SHOUTcast / Liquidsoap backend.
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
  updateMetadata(stationId: string, meta: StreamMetadata): Promise<StreamControlResult>;
  status(stationId: string): Promise<StreamStatus>;
}

interface StubStationState {
  connected: boolean;
  startedAtMs: number | null;
  lastMetadata: StreamMetadata | null;
}

/**
 * Module-level state. This is acceptable as a TEMPORARY shim for the stub:
 * - Each Worker invocation may hit a different isolate, so this is best-effort.
 * - The real adapter (AzuraCast) will read state from the upstream API, not
 *   from in-process memory.
 * - Tests reset this via `__resetStubStreamControlForTests()`.
 */
const STUB_STATE: Map<string, StubStationState> = new Map();

function nowMs(opts?: { now?: number }): number {
  return opts?.now ?? Date.now();
}

function defaultState(): StubStationState {
  return { connected: false, startedAtMs: null, lastMetadata: null };
}

export class StubStreamControl implements StreamControlAdapter {
  async start(stationId: string, opts?: { now?: number }): Promise<StreamControlResult> {
    const existing = STUB_STATE.get(stationId) ?? defaultState();
    // Idempotent: starting an already-started stream is a no-op.
    if (existing.connected) {
      return { ok: true };
    }
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

  async updateMetadata(stationId: string, meta: StreamMetadata): Promise<StreamControlResult> {
    const existing = STUB_STATE.get(stationId) ?? defaultState();
    STUB_STATE.set(stationId, {
      ...existing,
      lastMetadata: { ...meta },
    });
    return { ok: true };
  }

  async status(stationId: string, opts?: { now?: number }): Promise<StreamStatus> {
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

  /**
   * Test-only escape hatch — gives tests a peek at the queued metadata
   * even when no upstream stream is connected. The production adapter
   * will mirror this from the AzuraCast now-playing endpoint.
   */
  snapshot(stationId: string): StubStationState {
    return STUB_STATE.get(stationId) ?? defaultState();
  }
}

/**
 * Factory — the swap point.
 *
 * Today: always returns a StubStreamControl, regardless of env.
 * Future: when `STREAM_CONTROL_URL` is set, return `new AzuraCastAdapter(env)`.
 *
 * The env shape is locked-in here so the future swap is a one-line change
 * in this factory — no endpoint or test churn.
 */
export function getStreamControl(env: {
  STREAM_CONTROL_URL?: string;
  STREAM_CONTROL_KEY?: string;
}): StreamControlAdapter {
  // Touch the env keys so the type system locks them in even though
  // we don't use them yet — this is the documented swap point.
  void env.STREAM_CONTROL_URL;
  void env.STREAM_CONTROL_KEY;
  return new StubStreamControl();
}

/**
 * Test-only reset. Clears all stub state so each test starts fresh.
 * Not exported for production use.
 */
export function __resetStubStreamControlForTests(): void {
  STUB_STATE.clear();
}
