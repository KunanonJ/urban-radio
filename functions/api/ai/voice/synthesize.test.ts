import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequest } from './synthesize';
import { getSessionFromRequest } from '../../../_lib/session-jwt';
import type { SonicBloomEnv } from '../../../_lib/env';

const okSession = { sub: 'user-demo', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

function buildEnv(opts: {
  monthSpent?: number;
  plan?: string;
  noMember?: boolean;
  noOrg?: boolean;
} = {}): { env: SonicBloomEnv } {
  const prepare = vi.fn((sql: string) => {
    const binds: unknown[] = [];
    const chain = {
      bind: (...args: unknown[]) => {
        binds.push(...args);
        return chain;
      },
      first: () => {
        if (/FROM stations/i.test(sql)) {
          if (opts.noOrg) return Promise.resolve(null);
          return Promise.resolve({ org_id: 'default', plan: opts.plan ?? 'starter' });
        }
        if (/FROM ai_usage/i.test(sql)) {
          return Promise.resolve({ total: opts.monthSpent ?? 0 });
        }
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
  return {
    env: { DB: { prepare } as unknown as D1Database, AUTH_JWT_SECRET: 'test-secret' } as SonicBloomEnv,
  };
}

function buildRequest(body: unknown, method = 'POST') {
  return new Request('http://localhost/api/ai/voice/synthesize', {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      cookie: 'sb_session=valid-token',
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/ai/voice/synthesize', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const { env } = buildEnv();
    const res = await onRequest({ env, request: buildRequest({ text: 'hi', voiceId: 'v1' }) });
    expect(res.status).toBe(401);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({ noMember: true });
    const res = await onRequest({ env, request: buildRequest({ text: 'hi', voiceId: 'v1' }) });
    expect(res.status).toBe(403);
  });

  test('given missing text > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv();
    const res = await onRequest({ env, request: buildRequest({ voiceId: 'v1' }) });
    expect(res.status).toBe(400);
  });

  test('given invalid JSON > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv();
    const res = await onRequest({ env, request: buildRequest('not json') });
    expect(res.status).toBe(400);
  });

  test('given free plan > returns 402 cap_hit', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({ plan: 'free' });
    const res = await onRequest({
      env,
      request: buildRequest({ text: 'hello world', voiceId: 'stock-female-warm' }),
    });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: string; reason?: string };
    expect(body.error).toBe('cap_hit');
  });

  test('given starter plan + valid body > returns 200 with audio + usage', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv({ plan: 'starter' });
    const res = await onRequest({
      env,
      request: buildRequest({ text: 'Hello listeners', voiceId: 'stock-male-energetic' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { audioBase64: string };
      provider: string;
      usage: { unit: string; count: number };
    };
    expect(body.ok).toBe(true);
    expect(typeof body.data.audioBase64).toBe('string');
    expect(body.data.audioBase64.length).toBeGreaterThan(0);
    expect(body.provider).toBe('stub');
    expect(body.usage.unit).toBe('characters');
    expect(body.usage.count).toBe('Hello listeners'.length);
  });

  test('given GET method > returns 405', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const { env } = buildEnv();
    const res = await onRequest({
      env,
      request: new Request('http://localhost/api/ai/voice/synthesize', {
        method: 'GET',
        headers: { cookie: 'sb_session=x' },
      }),
    });
    expect(res.status).toBe(405);
  });
});
