import { describe, test, expect, vi, beforeEach } from 'vitest';

import { onRequestGet } from './healthz';
import type { SonicBloomEnv } from '../_lib/env';

const buildDb = (opts: { selectOneResult?: unknown; throws?: boolean } = {}) => {
  const first = vi.fn().mockImplementation(() => {
    if (opts.throws) throw new Error('db down');
    return Promise.resolve(opts.selectOneResult ?? { ok: 1 });
  });
  const prepare = vi.fn(() => ({ first }));
  return { prepare, first };
};

const buildRequest = (path = '/api/healthz') =>
  new Request(`http://localhost${path}`, { method: 'GET' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/healthz', () => {
  test('given no probe param > returns ok with timestamp and no DB query', async () => {
    const db = buildDb();
    const env = { DB: db as unknown as D1Database } as SonicBloomEnv;
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; ts: number };
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('number');
    expect(body.ts).toBeGreaterThan(1_700_000_000_000);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  test('requires no auth — no session check, no error from missing token', async () => {
    const db = buildDb();
    const env = {
      DB: db as unknown as D1Database,
      AUTH_JWT_SECRET: 'set-but-irrelevant',
    } as SonicBloomEnv;
    const res = await onRequestGet({ env, request: buildRequest() });
    expect(res.status).toBe(200);
  });

  test('given ?probe=db > pings DB and reports connected', async () => {
    const db = buildDb({ selectOneResult: { ok: 1 } });
    const env = { DB: db as unknown as D1Database } as SonicBloomEnv;
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/healthz?probe=db'),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe('connected');
    expect(db.prepare).toHaveBeenCalledWith('SELECT 1');
  });

  test('given ?probe=db with DB throwing > returns ok:false, db:error, 503', async () => {
    const db = buildDb({ throws: true });
    const env = { DB: db as unknown as D1Database } as SonicBloomEnv;
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/healthz?probe=db'),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(false);
    expect(body.db).toBe('error');
  });

  test('given ?probe=db with no DB binding > reports db:unavailable', async () => {
    const env = {} as SonicBloomEnv;
    const res = await onRequestGet({
      env,
      request: buildRequest('/api/healthz?probe=db'),
    });
    // Public uptime probes should still get a quick answer, but unavailable DB is 503.
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body.db).toBe('unavailable');
  });
});
