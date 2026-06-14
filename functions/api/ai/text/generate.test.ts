import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequest } from './generate';
import { getSessionFromRequest } from '../../../_lib/session-jwt';
import type { SonicBloomEnv } from '../../../_lib/env';

const okSession = { sub: 'user-demo', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

function buildEnv(opts: { plan?: string; noMember?: boolean } = {}): SonicBloomEnv {
  const prepare = vi.fn((sql: string) => {
    const chain = {
      bind: () => chain,
      first: () => {
        if (/FROM stations/i.test(sql)) {
          return Promise.resolve({ org_id: 'default', plan: opts.plan ?? 'starter' });
        }
        if (/FROM ai_usage/i.test(sql)) return Promise.resolve({ total: 0 });
        return Promise.resolve(null);
      },
      all: () => {
        if (/FROM station_members/i.test(sql)) {
          return Promise.resolve({
            results: opts.noMember ? [] : [memberRow],
            success: true,
          });
        }
        return Promise.resolve({ results: [], success: true });
      },
      run: () => Promise.resolve({ success: true }),
    };
    return chain;
  });
  return { DB: { prepare } as unknown as D1Database, AUTH_JWT_SECRET: 'test-secret' } as SonicBloomEnv;
}

function buildRequest(body: unknown) {
  return new Request('http://localhost/api/ai/text/generate', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', cookie: 'sb_session=valid-token' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/ai/text/generate', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const env = buildEnv();
    const res = await onRequest({ env, request: buildRequest({ topic: 'station_id' }) });
    expect(res.status).toBe(401);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv({ noMember: true });
    const res = await onRequest({ env, request: buildRequest({ topic: 'station_id' }) });
    expect(res.status).toBe(403);
  });

  test('given missing topic > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv();
    const res = await onRequest({ env, request: buildRequest({}) });
    expect(res.status).toBe(400);
  });

  test('given unknown topic > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv();
    const res = await onRequest({ env, request: buildRequest({ topic: 'not-a-topic' }) });
    expect(res.status).toBe(400);
  });

  test('given starter plan + frontsell topic > returns 200 with text', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv();
    const res = await onRequest({
      env,
      request: buildRequest({
        topic: 'frontsell',
        tone: 'energetic',
        context: { artist: 'Daft Punk', title: 'One More Time' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { text: string };
      provider: string;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.data.text).toBe('string');
    expect(body.data.text.length).toBeGreaterThan(0);
    expect(body.provider).toBe('stub');
  });

  test('given free plan > returns 402', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv({ plan: 'free' });
    const res = await onRequest({
      env,
      request: buildRequest({ topic: 'station_id' }),
    });
    expect(res.status).toBe(402);
  });
});
