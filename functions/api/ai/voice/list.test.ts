import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../_lib/session-jwt', () => ({
  getSessionFromRequest: vi.fn(),
}));

import { onRequest } from './list';
import { getSessionFromRequest } from '../../../_lib/session-jwt';
import type { SonicBloomEnv } from '../../../_lib/env';

const okSession = { sub: 'user-demo', username: 'demo' };
const memberRow = { station_id: 'urban-radio', role: 'admin' };

function buildEnv(opts: { noMember?: boolean } = {}): SonicBloomEnv {
  const prepare = vi.fn((sql: string) => {
    const chain = {
      bind: () => chain,
      first: () => Promise.resolve(null),
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

function buildRequest(query = '') {
  return new Request(`http://localhost/api/ai/voice/list${query}`, {
    method: 'GET',
    headers: { cookie: 'sb_session=valid-token' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/ai/voice/list', () => {
  test('given no session > returns 401', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(null);
    const env = buildEnv();
    const res = await onRequest({ env, request: buildRequest() });
    expect(res.status).toBe(401);
  });

  test('given no station membership > returns 403', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv({ noMember: true });
    const res = await onRequest({ env, request: buildRequest() });
    expect(res.status).toBe(403);
  });

  test('given session > returns 200 with voice array (default scope)', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv();
    const res = await onRequest({ env, request: buildRequest() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { id: string; scope: string }[];
      provider: string;
    };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.provider).toBe('stub');
  });

  test('given scope=cloned > returns only cloned voices', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv();
    const res = await onRequest({ env, request: buildRequest('?scope=cloned') });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { id: string; scope: string }[];
    };
    expect(body.data.every((v) => v.scope === 'cloned')).toBe(true);
  });

  test('given invalid scope > returns 400', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv();
    const res = await onRequest({ env, request: buildRequest('?scope=not-a-scope') });
    expect(res.status).toBe(400);
  });

  test('given POST method > returns 405', async () => {
    vi.mocked(getSessionFromRequest).mockResolvedValue(okSession);
    const env = buildEnv();
    const res = await onRequest({
      env,
      request: new Request('http://localhost/api/ai/voice/list', {
        method: 'POST',
        headers: { cookie: 'sb_session=x' },
      }),
    });
    expect(res.status).toBe(405);
  });
});
