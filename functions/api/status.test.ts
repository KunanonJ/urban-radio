import { describe, test, expect, vi, beforeEach } from 'vitest';

import { onRequestGet } from './status';
import { __resetStubStreamControlForTests } from '../_lib/stream-control';
import type { SonicBloomEnv } from '../_lib/env';

interface PreparedStmt {
  sql: string;
  binds: unknown[];
}

const buildDb = (firstResults: unknown[]) => {
  const prepared: PreparedStmt[] = [];
  let idx = 0;
  const prepare = vi.fn((sql: string) => {
    const stmt: PreparedStmt = { sql, binds: [] };
    prepared.push(stmt);
    return {
      bind: (...args: unknown[]) => {
        stmt.binds.push(...args);
        return {
          first: vi.fn().mockImplementation(() => {
            const r = firstResults[idx];
            idx += 1;
            return Promise.resolve(r);
          }),
        };
      },
      first: vi.fn().mockImplementation(() => {
        const r = firstResults[idx];
        idx += 1;
        return Promise.resolve(r);
      }),
    };
  });
  return { prepare, prepared };
};

const buildRequest = (path = '/api/status') =>
  new Request(`http://localhost${path}`, { method: 'GET' });

beforeEach(() => {
  vi.clearAllMocks();
  __resetStubStreamControlForTests();
});

describe('GET /api/status', () => {
  test('given DB binding > returns aggregate shape', async () => {
    const db = buildDb([{ at: '2026-01-01T00:00:00Z' }, { played_at: '2026-01-01T00:00:00Z' }]);
    const env = { DB: db as unknown as D1Database } as SonicBloomEnv;
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      ts: number;
      encoder: { connected: boolean; source: string; listeners: number };
      scheduler: { lastHeartbeatAt: string | null };
      lastBroadcastAt: string | null;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('number');
    expect(body.encoder).toBeDefined();
    expect(typeof body.encoder.connected).toBe('boolean');
    expect(body.encoder.source).toBe('stub');
    expect(body.scheduler).toBeDefined();
    expect('lastHeartbeatAt' in body.scheduler).toBe(true);
    expect('lastBroadcastAt' in body).toBe(true);
  });

  test('public — no auth check, no 401 even without session', async () => {
    const db = buildDb([null, null]);
    const env = {
      DB: db as unknown as D1Database,
      AUTH_JWT_SECRET: 'set-but-irrelevant-for-public-route',
    } as SonicBloomEnv;
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
  });

  test('encoder reflects current stream-control adapter (stub: connected=false initially)', async () => {
    const db = buildDb([null, null]);
    const env = { DB: db as unknown as D1Database } as SonicBloomEnv;
    const res = await onRequestGet({ env, request: buildRequest() });
    const body = (await res.json()) as {
      encoder: { connected: boolean; listeners: number; source: string };
    };
    expect(body.encoder.connected).toBe(false);
    expect(body.encoder.listeners).toBe(0);
    expect(body.encoder.source).toBe('stub');
  });

  test('given audit_log heartbeat present > returns scheduler.lastHeartbeatAt', async () => {
    const heartbeatAt = '2026-05-01T12:00:00Z';
    const db = buildDb([{ at: heartbeatAt }, null]);
    const env = { DB: db as unknown as D1Database } as SonicBloomEnv;
    const res = await onRequestGet({ env, request: buildRequest() });
    const body = (await res.json()) as { scheduler: { lastHeartbeatAt: string | null } };
    expect(body.scheduler.lastHeartbeatAt).toBe(heartbeatAt);
  });

  test('given play_log row present > returns lastBroadcastAt', async () => {
    const playedAt = '2026-05-01T13:00:00Z';
    const db = buildDb([null, { played_at: playedAt }]);
    const env = { DB: db as unknown as D1Database } as SonicBloomEnv;
    const res = await onRequestGet({ env, request: buildRequest() });
    const body = (await res.json()) as { lastBroadcastAt: string | null };
    expect(body.lastBroadcastAt).toBe(playedAt);
  });

  test('given no DB binding > returns ok with nulls (degraded mode)', async () => {
    const env = {} as SonicBloomEnv;
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      scheduler: { lastHeartbeatAt: string | null };
      lastBroadcastAt: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.scheduler.lastHeartbeatAt).toBeNull();
    expect(body.lastBroadcastAt).toBeNull();
  });

  test('does not crash when DB queries throw — returns safe nulls', async () => {
    const throwingPrepare = vi.fn(() => {
      throw new Error('db blown');
    });
    const env = {
      DB: { prepare: throwingPrepare } as unknown as D1Database,
    } as SonicBloomEnv;
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { scheduler: { lastHeartbeatAt: string | null } };
    expect(body.scheduler.lastHeartbeatAt).toBeNull();
  });
});
