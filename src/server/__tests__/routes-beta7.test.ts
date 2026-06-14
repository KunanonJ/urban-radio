// @vitest-environment node
// AI route handlers use `jose` (HS256) via `requireStation`; see β1 tests for context.

/**
 * Wave RM-β7 — AI Next.js Route Handlers.
 *
 * Every test exercises the named handler with a pg-mem-backed Drizzle client
 * and an injected mock AI provider. No test reaches a real provider; the
 * factory-level `process.env` reads are bypassed entirely.
 *
 * Contract assertions match `functions/api/ai/**` so the Cloudflare and
 * Railway stacks stay observationally identical during dual-stack.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β7.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';

import { getVoiceList } from '@/app/api/ai/voice/list/route-impl';
import { postVoiceSynthesize } from '@/app/api/ai/voice/synthesize/route-impl';
import { postTextGenerate } from '@/app/api/ai/text/generate/route-impl';
import { postTranscribe } from '@/app/api/ai/transcribe/route-impl';
import { postAnrRecognize } from '@/app/api/ai/anr/recognize/route-impl';
import type {
  AiResult,
  AnrProvider,
  TextProvider,
  TranscribeProvider,
  VoiceProvider,
} from '@/lib/ai';
import {
  signSessionToken,
  sessionCookieName,
} from '@/server/auth/session-jwt';
import {
  createTestDbWithUser,
  type TestDbHandle,
} from '@/server/test-utils/db';
import {
  createMemoryRateLimiter,
  defaultRateLimiter,
} from '@/server/rate-limit';

import type { DbClient } from '@/db/client';

const SECRET = 'beta7-test-secret';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The β1 test pattern: `handle.db` is a `PgRemoteDatabase` (pg-proxy) that's
 * structurally a `NodePgDatabase` so far as Drizzle queries are concerned.
 * Cast at the harness layer so each test reads cleanly.
 */
function asDbClient(handle: TestDbHandle): DbClient {
  return handle.db as unknown as DbClient;
}

/** Upgrade the seeded org to a paid plan so cost-guard doesn't 402 every test. */
function setOrgPlan(
  handle: TestDbHandle,
  orgId: string,
  plan: 'free' | 'starter' | 'pro' | 'enterprise',
): void {
  handle.mem.public.none(
    `UPDATE organizations SET plan = '${plan}' WHERE id = '${orgId}'`,
  );
}

async function authedCookie(userId: string, username: string): Promise<string> {
  const token = await signSessionToken(SECRET, { sub: userId, username });
  return `${sessionCookieName()}=${encodeURIComponent(token)}`;
}

function buildRequest(
  url: string,
  init: {
    cookie?: string;
    method?: string;
    body?: unknown;
  } = {},
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (init.cookie) headers.Cookie = init.cookie;
  const body =
    init.body === undefined
      ? undefined
      : typeof init.body === 'string'
        ? init.body
        : JSON.stringify(init.body);
  return new Request(url, {
    method: init.method ?? 'POST',
    headers,
    body,
  });
}

/** Count rows in ai_usage for assertions about persistence. */
function countAiUsage(handle: TestDbHandle): number {
  const rows = handle.mem.public.many('SELECT COUNT(*)::int AS c FROM ai_usage');
  return Number((rows[0] as { c: number }).c);
}

/** Read every ai_usage row for an org, ordered for assertion stability. */
function selectAiUsage(
  handle: TestDbHandle,
  orgId: string,
): Array<Record<string, unknown>> {
  return handle.mem.public.many(
    `SELECT * FROM ai_usage WHERE org_id = '${orgId}' ORDER BY at, id`,
  );
}

function countAuditLog(handle: TestDbHandle): number {
  const rows = handle.mem.public.many(
    'SELECT COUNT(*)::int AS c FROM audit_log',
  );
  return Number((rows[0] as { c: number }).c);
}

// ---------------------------------------------------------------------------
// Mock providers
// ---------------------------------------------------------------------------

function makeVoiceProvider(): VoiceProvider {
  return {
    name: 'stub',
    async listVoices(opts = {}) {
      const scope = opts.scope ?? 'all';
      const library = [
        { id: 'v1', name: 'V1', scope: 'cloned' as const, language: 'en' },
        { id: 'v2', name: 'V2', scope: 'stock' as const, language: 'en' },
      ];
      const filtered =
        scope === 'all' ? library : library.filter((v) => v.scope === scope);
      return {
        ok: true,
        provider: 'stub',
        data: filtered,
        usage: { unit: 'requests', count: 1, estimatedCostUsd: 0 },
      };
    },
    async synthesize(opts) {
      return {
        ok: true,
        provider: 'stub',
        data: { audioBase64: `audio-of-${opts.text.length}-chars` },
        usage: {
          unit: 'characters',
          count: opts.text.length,
          estimatedCostUsd: 0.0003 * opts.text.length,
        },
      };
    },
  };
}

function makeTextProvider(): TextProvider {
  return {
    name: 'stub',
    async generate(opts) {
      const text = `[mock ${opts.topic}] copy`;
      return {
        ok: true,
        provider: 'stub',
        data: { text },
        usage: {
          unit: 'tokens',
          count: 8,
          estimatedCostUsd: 0.00002,
        },
      };
    },
  };
}

function makeTranscribeProvider(): TranscribeProvider {
  return {
    name: 'stub',
    async transcribe(opts) {
      if (!opts.audioBase64 && !opts.audioUrl) {
        return {
          ok: false,
          provider: 'stub',
          error: 'No audio input provided.',
        };
      }
      const segments = [{ text: '[mock]', startMs: 0, endMs: 1_000 }];
      return {
        ok: true,
        provider: 'stub',
        data: { segments, fullText: '[mock]' },
        usage: {
          unit: 'seconds',
          count: 1,
          estimatedCostUsd: 0.0001,
        },
      };
    },
  };
}

function makeAnrProvider(): AnrProvider {
  return {
    name: 'stub',
    async recognize(opts) {
      if (!opts.audioBase64 && !opts.audioUrl) {
        return {
          ok: false,
          provider: 'stub',
          error: 'No audio input provided.',
        };
      }
      const matches = [
        {
          title: 'Mock Track',
          artist: 'Mock Artist',
          confidence: 0.9,
        },
      ];
      return {
        ok: true,
        provider: 'stub',
        data: { matches },
        usage: {
          unit: 'seconds',
          count: opts.windowSeconds ?? 12,
          estimatedCostUsd: 0.001,
        },
      };
    },
  };
}

/** A provider that always returns an error envelope — drives the 502 path. */
function makeErrorVoiceProvider(): VoiceProvider {
  return {
    name: 'stub',
    async listVoices() {
      return {
        ok: false,
        provider: 'stub',
        error: 'listVoices boom',
      };
    },
    async synthesize() {
      return {
        ok: false,
        provider: 'stub',
        error: 'synth boom',
      };
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  // Reset the process-wide rate limiter so bucket state does not bleed
  // between tests. Each rate-limit test injects its own isolated limiter
  // instance anyway, but this is the belt-and-suspenders defence.
  defaultRateLimiter.resetForTests();
});

// ---------------------------------------------------------------------------
// GET /api/ai/voice/list
// ---------------------------------------------------------------------------

describe('GET /api/ai/voice/list', () => {
  test('401 when no session is present', async () => {
    const { handle } = createTestDbWithUser();
    const res = await getVoiceList(
      buildRequest('http://localhost/api/ai/voice/list', { method: 'GET' }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
      },
    );
    expect(res.status).toBe(401);
  });

  test('403 when authed user has no station membership', async () => {
    const { handle } = createTestDbWithUser();
    // Add a second user with no station membership.
    handle.mem.public.none(
      `INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('user-orphan', 'orphan', 'pbkdf2:1:00:00', '2026-01-01T00:00:00Z')`,
    );
    const cookie = await authedCookie('user-orphan', 'orphan');
    const res = await getVoiceList(
      buildRequest('http://localhost/api/ai/voice/list', {
        method: 'GET',
        cookie,
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
      },
    );
    expect(res.status).toBe(403);
  });

  test('200 returns full voice library when no scope query', async () => {
    const { handle, user } = createTestDbWithUser();
    const cookie = await authedCookie(user.userId, user.username);
    const res = await getVoiceList(
      buildRequest('http://localhost/api/ai/voice/list', {
        method: 'GET',
        cookie,
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ id: string; scope: string }>;
      provider: string;
    };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('stub');
    expect(body.data.length).toBeGreaterThan(0);
  });

  test('200 filters to cloned scope', async () => {
    const { handle, user } = createTestDbWithUser();
    const cookie = await authedCookie(user.userId, user.username);
    const res = await getVoiceList(
      buildRequest('http://localhost/api/ai/voice/list?scope=cloned', {
        method: 'GET',
        cookie,
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; scope: string }>;
    };
    expect(body.data.every((v) => v.scope === 'cloned')).toBe(true);
  });

  test('400 on unknown scope value', async () => {
    const { handle, user } = createTestDbWithUser();
    const cookie = await authedCookie(user.userId, user.username);
    const res = await getVoiceList(
      buildRequest('http://localhost/api/ai/voice/list?scope=cocktail', {
        method: 'GET',
        cookie,
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
      },
    );
    expect(res.status).toBe(400);
  });

  test('502 when provider returns an error envelope', async () => {
    const { handle, user } = createTestDbWithUser();
    const cookie = await authedCookie(user.userId, user.username);
    const res = await getVoiceList(
      buildRequest('http://localhost/api/ai/voice/list', {
        method: 'GET',
        cookie,
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeErrorVoiceProvider(),
      },
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    // Pentest M-14: provider error string scrubbed; client gets a generic
    // envelope. The raw provider error stays in server logs.
    expect(body.error).toBe('Provider failure');
  });
});

// ---------------------------------------------------------------------------
// POST /api/ai/voice/synthesize
// ---------------------------------------------------------------------------

describe('POST /api/ai/voice/synthesize', () => {
  test('401 when no session cookie', async () => {
    const { handle } = createTestDbWithUser();
    setOrgPlan(handle, 'org-test', 'starter');
    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        body: { text: 'hi', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
      },
    );
    expect(res.status).toBe(401);
  });

  test('400 on invalid JSON body', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: 'not-json{',
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
      },
    );
    expect(res.status).toBe(400);
  });

  test('400 when required fields are missing', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: { text: '' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
      },
    );
    expect(res.status).toBe(400);
  });

  test('402 cap_hit on free plan', async () => {
    const { handle, user } = createTestDbWithUser();
    // org-test seeded with plan='free' already, but be explicit.
    setOrgPlan(handle, user.orgId, 'free');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: { text: 'hello listeners', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
      },
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('cap_hit');
  });

  test('200 on starter plan + writes ai_usage row + writes audit_log', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);

    expect(countAiUsage(handle)).toBe(0);
    expect(countAuditLog(handle)).toBe(0);

    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: { text: 'Hello listeners', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
        usageId: 'usage-v1',
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      provider: string;
      data: { audioBase64: string };
      usage: { unit: string; count: number; estimatedCostUsd: number };
    };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('stub');
    expect(body.data.audioBase64).toBe(
      `audio-of-${'Hello listeners'.length}-chars`,
    );
    expect(body.usage.unit).toBe('characters');
    expect(body.usage.count).toBe('Hello listeners'.length);

    const rows = selectAiUsage(handle, user.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('usage-v1');
    expect(rows[0].capability).toBe('voice');
    expect(rows[0].provider).toBe('stub');
    expect(rows[0].unit).toBe('characters');
    expect(rows[0].count).toBe('Hello listeners'.length);
    expect(rows[0].station_id).toBe(user.stationId);
    expect(rows[0].actor_user_id).toBe(user.userId);
    expect(rows[0].request_summary).toBe('Hello listeners');

    expect(countAuditLog(handle)).toBe(1);
  });

  test('502 when provider returns error envelope (no ai_usage row)', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);

    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: { text: 'hi', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeErrorVoiceProvider(),
      },
    );

    expect(res.status).toBe(502);
    expect(countAiUsage(handle)).toBe(0);
  });

  test('truncates request_summary to 256 chars', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'pro');
    const cookie = await authedCookie(user.userId, user.username);

    const longText = 'x'.repeat(500);
    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: { text: longText, voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
        usageId: 'usage-long',
      },
    );

    expect(res.status).toBe(200);
    const rows = selectAiUsage(handle, user.orgId);
    expect(rows).toHaveLength(1);
    const summary = rows[0].request_summary as string;
    expect(summary.length).toBeLessThanOrEqual(256);
  });

  test('pentest H-08: ai_usage reservation exists BEFORE provider call (two-phase)', async () => {
    // Two-phase contract: a "pending" reservation row is inserted under
    // SERIALIZABLE before the provider call so concurrent requests cannot
    // both read the same SUM and double-spend. After provider success the
    // row is reconciled to the real cost; after provider failure it is
    // deleted. The test snapshots `ai_usage` from inside the provider mock.
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);

    let snapshotAtProviderTime: Array<Record<string, unknown>> = [];
    const snapshottingProvider: VoiceProvider = {
      // Use a real AiProvider name distinct from 'stub'/'pending' so the
      // reconciliation assertion below has something concrete to check.
      name: 'openai',
      async listVoices() {
        return {
          ok: true,
          provider: 'openai',
          data: [],
          usage: { unit: 'requests', count: 1, estimatedCostUsd: 0 },
        };
      },
      async synthesize(opts) {
        snapshotAtProviderTime = selectAiUsage(handle, user.orgId);
        return {
          ok: true,
          provider: 'openai',
          data: { audioBase64: 'fake' },
          usage: {
            unit: 'characters',
            count: opts.text.length,
            estimatedCostUsd: 0.0003 * opts.text.length,
          },
        };
      },
    };

    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: { text: 'hello world', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: snapshottingProvider,
        usageId: 'usage-reserve-1',
      },
    );

    expect(res.status).toBe(200);

    // During the provider call, exactly one reservation row exists with
    // the placeholder provider name.
    expect(snapshotAtProviderTime.length).toBe(1);
    expect(snapshotAtProviderTime[0].id).toBe('usage-reserve-1');
    expect(snapshotAtProviderTime[0].provider).toBe('pending');

    // After provider returns, the row is reconciled with actual values.
    const final = selectAiUsage(handle, user.orgId);
    expect(final).toHaveLength(1);
    expect(final[0].id).toBe('usage-reserve-1');
    expect(final[0].provider).toBe('openai');
    expect(final[0].unit).toBe('characters');
    expect(final[0].count).toBe('hello world'.length);
  });

  test('pentest H-08: reservation row is deleted when provider throws', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);

    const throwingProvider: VoiceProvider = {
      name: 'deepgram',
      async listVoices() {
        return {
          ok: true,
          provider: 'deepgram',
          data: [],
          usage: { unit: 'requests', count: 1, estimatedCostUsd: 0 },
        };
      },
      async synthesize() {
        throw new Error('provider exploded');
      },
    };

    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: { text: 'hi', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: throwingProvider,
        usageId: 'usage-throw-1',
      },
    );

    expect(res.status).toBe(502);
    // Reservation row was deleted so the budget is freed.
    expect(countAiUsage(handle)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/ai/text/generate
// ---------------------------------------------------------------------------

describe('POST /api/ai/text/generate', () => {
  test('401 when no session cookie', async () => {
    const { handle } = createTestDbWithUser();
    setOrgPlan(handle, 'org-test', 'starter');
    const res = await postTextGenerate(
      buildRequest('http://localhost/api/ai/text/generate', {
        body: { topic: 'frontsell' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        textProvider: makeTextProvider(),
      },
    );
    expect(res.status).toBe(401);
  });

  test('400 on invalid JSON body', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postTextGenerate(
      buildRequest('http://localhost/api/ai/text/generate', {
        cookie,
        body: 'oops not json',
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        textProvider: makeTextProvider(),
      },
    );
    expect(res.status).toBe(400);
  });

  test('400 when topic is not in enum', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postTextGenerate(
      buildRequest('http://localhost/api/ai/text/generate', {
        cookie,
        body: { topic: 'not-a-topic' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        textProvider: makeTextProvider(),
      },
    );
    expect(res.status).toBe(400);
  });

  test('200 on starter plan + writes ai_usage row with capability=text + token unit', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postTextGenerate(
      buildRequest('http://localhost/api/ai/text/generate', {
        cookie,
        body: { topic: 'frontsell', context: { title: 'Song A' } },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        textProvider: makeTextProvider(),
        usageId: 'usage-text',
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { text: string };
      usage: { unit: string; count: number };
      provider: string;
    };
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('stub');
    expect(body.data.text).toBe('[mock frontsell] copy');
    expect(body.usage.unit).toBe('tokens');

    const rows = selectAiUsage(handle, user.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe('text');
    expect(rows[0].unit).toBe('tokens');
    // request_summary captures topic + optional title for grep.
    expect(rows[0].request_summary).toBe('frontsell: Song A');
  });
});

// ---------------------------------------------------------------------------
// POST /api/ai/transcribe
// ---------------------------------------------------------------------------

describe('POST /api/ai/transcribe', () => {
  test('400 when neither audioBase64 nor audioUrl is provided', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postTranscribe(
      buildRequest('http://localhost/api/ai/transcribe', {
        cookie,
        body: {},
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        transcribeProvider: makeTranscribeProvider(),
      },
    );
    expect(res.status).toBe(400);
  });

  test('400 on invalid JSON', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postTranscribe(
      buildRequest('http://localhost/api/ai/transcribe', {
        cookie,
        body: '{not-json',
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        transcribeProvider: makeTranscribeProvider(),
      },
    );
    expect(res.status).toBe(400);
  });

  test('200 with audioUrl + writes ai_usage row with capability=transcribe', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postTranscribe(
      buildRequest('http://localhost/api/ai/transcribe', {
        cookie,
        body: { audioUrl: 'https://example.com/clip.mp3' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        transcribeProvider: makeTranscribeProvider(),
        usageId: 'usage-tx',
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { fullText: string };
      provider: string;
    };
    expect(body.ok).toBe(true);
    expect(body.data.fullText).toBe('[mock]');

    const rows = selectAiUsage(handle, user.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe('transcribe');
    expect(rows[0].unit).toBe('seconds');
    expect(rows[0].request_summary).toBe('https://example.com/clip.mp3');
  });

  test('200 with inline audioBase64 + summary mentions inline size', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postTranscribe(
      buildRequest('http://localhost/api/ai/transcribe', {
        cookie,
        body: { audioBase64: 'abc' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        transcribeProvider: makeTranscribeProvider(),
        usageId: 'usage-tx-inline',
      },
    );

    expect(res.status).toBe(200);
    const rows = selectAiUsage(handle, user.orgId);
    expect(rows[0].request_summary).toBe('inline-audio-3b');
  });
});

// ---------------------------------------------------------------------------
// POST /api/ai/anr/recognize
// ---------------------------------------------------------------------------

describe('POST /api/ai/anr/recognize', () => {
  test('400 when neither audioBase64 nor audioUrl is provided', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postAnrRecognize(
      buildRequest('http://localhost/api/ai/anr/recognize', {
        cookie,
        body: {},
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        anrProvider: makeAnrProvider(),
      },
    );
    expect(res.status).toBe(400);
  });

  test('401 with no cookie', async () => {
    const { handle } = createTestDbWithUser();
    setOrgPlan(handle, 'org-test', 'starter');
    const res = await postAnrRecognize(
      buildRequest('http://localhost/api/ai/anr/recognize', {
        body: { audioUrl: 'https://example.com/x.mp3' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        anrProvider: makeAnrProvider(),
      },
    );
    expect(res.status).toBe(401);
  });

  test('200 + writes ai_usage row with capability=anr', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postAnrRecognize(
      buildRequest('http://localhost/api/ai/anr/recognize', {
        cookie,
        body: {
          audioUrl: 'https://example.com/sample.mp3',
          windowSeconds: 10,
        },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        anrProvider: makeAnrProvider(),
        usageId: 'usage-anr',
      },
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: {
        matches: Array<{ title: string; artist: string; confidence: number }>;
      };
      usage: { unit: string; count: number };
    };
    expect(body.ok).toBe(true);
    expect(body.data.matches[0].title).toBe('Mock Track');
    expect(body.usage.count).toBe(10);

    const rows = selectAiUsage(handle, user.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].capability).toBe('anr');
    expect(rows[0].unit).toBe('seconds');
    expect(rows[0].request_summary).toBe('https://example.com/sample.mp3');
  });
});

// ---------------------------------------------------------------------------
// Pentest M-13: SSRF allowlist integration tests
// ---------------------------------------------------------------------------

describe('POST /api/ai/anr/recognize — M-13 audioUrl SSRF guard', () => {
  test('400 when audioUrl uses http:// (protocol_not_allowed)', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postAnrRecognize(
      buildRequest('http://localhost/api/ai/anr/recognize', {
        cookie,
        body: { audioUrl: 'http://1.2.3.4/foo.mp3' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        anrProvider: makeAnrProvider(),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      details: { reason: string };
    };
    expect(body.error).toBe('audioUrl rejected');
    expect(['protocol_not_allowed', 'ip_literal_blocked']).toContain(
      body.details.reason,
    );
  });

  test('400 when audioUrl is an RFC-1918 IP address (ip_literal_blocked)', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postAnrRecognize(
      buildRequest('http://localhost/api/ai/anr/recognize', {
        cookie,
        body: { audioUrl: 'https://192.168.1.1/foo.mp3' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        anrProvider: makeAnrProvider(),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      details: { reason: string };
    };
    expect(body.error).toBe('audioUrl rejected');
    expect(body.details.reason).toBe('ip_literal_blocked');
  });

  test('200 when audioUrl is a valid public HTTPS URL (unchanged behavior)', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postAnrRecognize(
      buildRequest('http://localhost/api/ai/anr/recognize', {
        cookie,
        body: { audioUrl: 'https://example.com/foo.mp3' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        anrProvider: makeAnrProvider(),
        usageId: 'usage-anr-ssrf-ok',
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('POST /api/ai/transcribe — M-13 audioUrl SSRF guard', () => {
  test('400 when audioUrl uses http:// (protocol_not_allowed)', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postTranscribe(
      buildRequest('http://localhost/api/ai/transcribe', {
        cookie,
        body: { audioUrl: 'http://1.2.3.4/foo.mp3' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        transcribeProvider: makeTranscribeProvider(),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      details: { reason: string };
    };
    expect(body.error).toBe('audioUrl rejected');
    expect(['protocol_not_allowed', 'ip_literal_blocked']).toContain(
      body.details.reason,
    );
  });

  test('400 when audioUrl is an RFC-1918 IP address (ip_literal_blocked)', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postTranscribe(
      buildRequest('http://localhost/api/ai/transcribe', {
        cookie,
        body: { audioUrl: 'https://10.0.0.1/clip.mp3' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        transcribeProvider: makeTranscribeProvider(),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      details: { reason: string };
    };
    expect(body.error).toBe('audioUrl rejected');
    expect(body.details.reason).toBe('ip_literal_blocked');
  });

  test('200 when audioUrl is a valid public HTTPS URL (unchanged behavior)', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const cookie = await authedCookie(user.userId, user.username);
    const res = await postTranscribe(
      buildRequest('http://localhost/api/ai/transcribe', {
        cookie,
        body: { audioUrl: 'https://example.com/foo.mp3' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        transcribeProvider: makeTranscribeProvider(),
        usageId: 'usage-tx-ssrf-ok',
      },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cost-guard edge cases shared across capabilities
// ---------------------------------------------------------------------------

describe('cost-guard', () => {
  test('monthly cap accumulates from prior ai_usage rows', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter'); // $5 monthly cap
    // Seed an existing $4.99 spent this month.
    const now = new Date();
    const monthBucket = `${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1,
    ).padStart(2, '0')}-15T12:00:00Z`;
    handle.mem.public.none(
      `INSERT INTO ai_usage (id, org_id, station_id, actor_user_id, capability, provider, unit, count, estimated_cost_usd, at)
       VALUES ('seed-1', '${user.orgId}', '${user.stationId}', '${user.userId}', 'voice', 'stub', 'characters', 1, 4.99, '${monthBucket}')`,
    );

    const cookie = await authedCookie(user.userId, user.username);
    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        // FRONT_LOAD_USD for voice is $0.01 → $4.99 + $0.01 = $5.00 = cap → still passes.
        body: { text: 'hi', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
        usageId: 'usage-edge',
      },
    );
    // $4.99 + $0.01 = exactly $5.00 — cost-guard uses strict `> cap` so this should still pass.
    expect(res.status).toBe(200);
  });

  test('seeded $5.01 already spent on starter > returns 402', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'starter');
    const now = new Date();
    const monthBucket = `${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1,
    ).padStart(2, '0')}-15T12:00:00Z`;
    handle.mem.public.none(
      `INSERT INTO ai_usage (id, org_id, station_id, actor_user_id, capability, provider, unit, count, estimated_cost_usd, at)
       VALUES ('seed-2', '${user.orgId}', '${user.stationId}', '${user.userId}', 'voice', 'stub', 'characters', 1, 5.01, '${monthBucket}')`,
    );

    const cookie = await authedCookie(user.userId, user.username);
    const res = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: { text: 'hi', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
      },
    );
    expect(res.status).toBe(402);
    const body = (await res.json()) as { ok: boolean; reason: string };
    expect(body.reason).toBe('monthly_cap_hit');
  });
});

// ---------------------------------------------------------------------------
// Pentest H-09: AI endpoint rate limiting (per-station)
// ---------------------------------------------------------------------------

describe('AI route rate limiting (H-09)', () => {
  test('postVoiceSynthesize: 30 calls succeed; 31st returns 429', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'pro');
    const cookie = await authedCookie(user.userId, user.username);
    const limiter = createMemoryRateLimiter();

    // 30 allowed requests.
    for (let i = 0; i < 30; i++) {
      const res = await postVoiceSynthesize(
        buildRequest('http://localhost/api/ai/voice/synthesize', {
          cookie,
          body: { text: 'hi', voiceId: 'v1' },
        }),
        {
          db: asDbClient(handle),
          secret: SECRET,
          voiceProvider: makeVoiceProvider(),
          rateLimiter: limiter,
          usageId: `usage-rl-${i}`,
        },
      );
      expect(res.status).toBe(200);
    }

    // 31st is rate limited.
    const blocked = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: { text: 'hi', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
        rateLimiter: limiter,
      },
    );
    expect(blocked.status).toBe(429);
    const retryAfter = blocked.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    const body = (await blocked.json()) as { error: string };
    expect(body.error).toBe('rate_limited');
  });

  test('different station IDs have independent rate-limit buckets', async () => {
    // Station A.
    const { handle: handleA, user: userA } = createTestDbWithUser({
      userId: 'u-station-a',
      username: 'user-a',
      stationId: 'station-a',
      orgId: 'org-a',
    });
    setOrgPlan(handleA, 'org-a', 'pro');
    const cookieA = await authedCookie(userA.userId, userA.username);

    // Station B — separate DB, separate auth fixture.
    const { handle: handleB, user: userB } = createTestDbWithUser({
      userId: 'u-station-b',
      username: 'user-b',
      stationId: 'station-b',
      orgId: 'org-b',
    });
    setOrgPlan(handleB, 'org-b', 'pro');
    const cookieB = await authedCookie(userB.userId, userB.username);

    // Shared limiter — both stations are keyed by stationId so they should
    // not interfere with each other.
    const limiter = createMemoryRateLimiter();

    // Exhaust station-a's bucket.
    for (let i = 0; i < 30; i++) {
      await postVoiceSynthesize(
        buildRequest('http://localhost/api/ai/voice/synthesize', {
          cookie: cookieA,
          body: { text: 'hi', voiceId: 'v1' },
        }),
        {
          db: asDbClient(handleA),
          secret: SECRET,
          voiceProvider: makeVoiceProvider(),
          rateLimiter: limiter,
          usageId: `usage-a-${i}`,
        },
      );
    }
    const blockedA = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie: cookieA,
        body: { text: 'hi', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handleA),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
        rateLimiter: limiter,
      },
    );
    expect(blockedA.status).toBe(429);

    // Station B still has a fresh bucket — its request should succeed.
    const okB = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie: cookieB,
        body: { text: 'hi', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handleB),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
        rateLimiter: limiter,
        usageId: 'usage-b-0',
      },
    );
    expect(okB.status).toBe(200);
  });

  test('rate limit fires BEFORE runAiCapability (no ai_usage row created when blocked)', async () => {
    const { handle, user } = createTestDbWithUser();
    setOrgPlan(handle, user.orgId, 'pro');
    const cookie = await authedCookie(user.userId, user.username);
    const limiter = createMemoryRateLimiter();

    // Exhaust the bucket.
    for (let i = 0; i < 30; i++) {
      await postVoiceSynthesize(
        buildRequest('http://localhost/api/ai/voice/synthesize', {
          cookie,
          body: { text: 'hi', voiceId: 'v1' },
        }),
        {
          db: asDbClient(handle),
          secret: SECRET,
          voiceProvider: makeVoiceProvider(),
          rateLimiter: limiter,
          usageId: `usage-pre-${i}`,
        },
      );
    }
    const usageBeforeBlock = countAiUsage(handle);

    // The rate-limited request should not create any ai_usage row.
    const blocked = await postVoiceSynthesize(
      buildRequest('http://localhost/api/ai/voice/synthesize', {
        cookie,
        body: { text: 'hi', voiceId: 'v1' },
      }),
      {
        db: asDbClient(handle),
        secret: SECRET,
        voiceProvider: makeVoiceProvider(),
        rateLimiter: limiter,
      },
    );
    expect(blocked.status).toBe(429);
    expect(countAiUsage(handle)).toBe(usageBeforeBlock);
  });
});
