import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequest } from './recognize';
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
  return new Request('http://localhost/api/ai/anr/recognize', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', cookie: 'sb_session=valid-token' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/ai/anr/recognize', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const env = buildEnv();
    const res = await onRequest({ env, request: buildRequest({ audioUrl: 'https://x/y.mp3' }) });
    expect(res.status).toBe(401);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv({ noMember: true });
    const res = await onRequest({ env, request: buildRequest({ audioUrl: 'https://x/y.mp3' }) });
    expect(res.status).toBe(403);
  });

  test('given empty body > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv();
    const res = await onRequest({ env, request: buildRequest({}) });
    expect(res.status).toBe(400);
  });

  test('given audioUrl + starter plan > returns 200 with matches array', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv();
    const res = await onRequest({
      env,
      request: buildRequest({ audioUrl: 'https://example.com/clip.mp3', windowSeconds: 10 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { matches: { title: string; confidence: number }[] };
      provider: string;
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.matches)).toBe(true);
    expect(body.data.matches.length).toBeGreaterThan(0);
    expect(body.provider).toBe('stub');
  });

  test('given free plan > returns 402', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv({ plan: 'free' });
    const res = await onRequest({
      env,
      request: buildRequest({ audioUrl: 'https://example.com/clip.mp3' }),
    });
    expect(res.status).toBe(402);
  });
});
