// @vitest-environment node
// Route handlers use `jose` (HS256); see require-station.test.ts for context.

/**
 * Wave RM-β1 — Auth + Health Next.js Route Handlers.
 *
 * Each test exercises the named handler with a pg-mem-backed Drizzle client
 * and asserts on the response shape the Cloudflare counterpart emits. The
 * goal isn't to re-test the underlying Drizzle/pg-mem layer — that's covered
 * by `src/db/schema.test.ts`. We only verify the route's input → output
 * contract so the Railway and Cloudflare stacks stay observationally identical.
 */

import { describe, expect, test, beforeEach } from 'vitest';

import { getHealth } from '@/app/api/health/route-impl';
import { getHealthz } from '@/app/api/healthz/route-impl';
import { getStatus } from '@/app/api/status/route-impl';
import { getMe } from '@/app/api/auth/me/route-impl';
import { postLogin } from '@/app/api/auth/login/route-impl';
import { postLogout } from '@/app/api/auth/logout/route-impl';
import {
  signSessionToken,
  sessionCookieName,
} from '@/server/auth/session-jwt';
import {
  createTestDb,
  createTestDbWithUser,
} from '@/server/test-utils/db';
import {
  createMemoryRateLimiter,
  defaultRateLimiter,
} from '@/server/rate-limit';

const SECRET = 'beta1-test-secret';

// Reset the process-wide limiter before every test so rate-limit state from
// one test cannot bleed into another.
beforeEach(() => {
  defaultRateLimiter.resetForTests();
});

// A pre-computed pbkdf2 hash of "correcthorsebatterystaple" with iter=10, fixed salt.
// Recomputed at test runtime via crypto.subtle to keep the test self-contained
// without committing a static hash that goes stale.
async function hashPassword(plain: string): Promise<string> {
  const iter = 10;
  const salt = new Uint8Array([1, 2, 3, 4]);
  const enc = new TextEncoder().encode(plain);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iter, hash: 'SHA-256' },
    keyMaterial,
    32 * 8,
  );
  const hex = (u: Uint8Array) =>
    Array.from(u)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  return `pbkdf2:${iter}:${hex(salt)}:${hex(new Uint8Array(bits))}`;
}

// ---------------------------------------------------------------------------
// /api/health
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  test('pentest M-16/M-18: unauthenticated callers get minimal response (no trackCount, no schemaVersion)', async () => {
    const { handle } = createTestDbWithUser();
    // No request → unauthenticated path → minimal response.
    const res = await getHealth(undefined, { db: handle.db });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      db: string;
      trackCount?: number;
      schemaVersion?: number;
      r2?: string;
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('sonic-bloom');
    expect(body.db).toBe('connected');
    // Verbose fields MUST NOT leak to unauthenticated callers.
    expect(body.trackCount).toBeUndefined();
    expect(body.schemaVersion).toBeUndefined();
    expect(body.r2).toBeUndefined();
  });

  test('authenticated callers get the verbose snapshot', async () => {
    const { handle, user } = createTestDbWithUser();
    const token = await signSessionToken(SECRET, {
      sub: user.userId,
      username: user.username,
    });
    const request = new Request('http://localhost/api/health', {
      headers: { Cookie: `${sessionCookieName()}=${encodeURIComponent(token)}` },
    });
    const res = await getHealth(request, { db: handle.db, secret: SECRET });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      service: string;
      db: string;
      trackCount: number;
      schemaVersion: number;
    };
    expect(body.ok).toBe(true);
    expect(body.db).toBe('connected');
    expect(body.trackCount).toBe(0);
    expect(body.schemaVersion).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// /api/healthz
// ---------------------------------------------------------------------------

describe('GET /api/healthz', () => {
  test('bare mode returns 200 with ok+ts only', async () => {
    const res = await getHealthz(new Request('http://localhost/api/healthz'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      ts: number;
      db?: string;
    };
    expect(body.ok).toBe(true);
    expect(typeof body.ts).toBe('number');
    expect(body.db).toBeUndefined();
  });

  test('?probe=db pings the DB and reports connected', async () => {
    const { db } = createTestDb();
    const res = await getHealthz(
      new Request('http://localhost/api/healthz?probe=db'),
      { db },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(true);
    expect(body.db).toBe('connected');
  });

  test('?probe=db with explicit unavailable flag → 503 unavailable', async () => {
    const res = await getHealthz(
      new Request('http://localhost/api/healthz?probe=db'),
      { dbUnavailable: true },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; db: string };
    expect(body.ok).toBe(false);
    expect(body.db).toBe('unavailable');
  });
});

// ---------------------------------------------------------------------------
// /api/status
// ---------------------------------------------------------------------------

describe('GET /api/status', () => {
  test('returns stub encoder + null heartbeats on empty DB', async () => {
    const { db } = createTestDb();
    const res = await getStatus({ db, now: 1_700_000_000_000 });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      ts: number;
      encoder: { connected: boolean; source: string };
      scheduler: { lastHeartbeatAt: string | null };
      lastBroadcastAt: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.ts).toBe(1_700_000_000_000);
    expect(body.encoder.source).toBe('stub');
    expect(body.encoder.connected).toBe(false);
    expect(body.scheduler.lastHeartbeatAt).toBeNull();
    expect(body.lastBroadcastAt).toBeNull();
  });

  test('surfaces latest scheduler audit row + latest play-log row', async () => {
    const { handle } = createTestDbWithUser();
    // Seed scheduler heartbeat + a play-log row.
    handle.mem.public.none(
      "INSERT INTO audit_log (id, station_id, actor_user_id, action, target_type, target_id, at) VALUES ('al-1', 'station-test', 'user-test', 'scheduler_tick', 'system', 'system', '2026-05-01T10:00:00Z')",
    );
    handle.mem.public.none(
      "INSERT INTO play_log (id, station_id, title_snapshot, played_at, source) VALUES ('pl-1', 'station-test', 'Test Song', '2026-05-02T11:11:11Z', 'automation')",
    );

    const res = await getStatus({ db: handle.db });
    const body = (await res.json()) as {
      scheduler: { lastHeartbeatAt: string };
      lastBroadcastAt: string;
    };
    expect(body.scheduler.lastHeartbeatAt).toBe('2026-05-01T10:00:00Z');
    expect(body.lastBroadcastAt).toBe('2026-05-02T11:11:11Z');
  });
});

// ---------------------------------------------------------------------------
// /api/auth/me
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  test('reports authNotConfigured when AUTH_JWT_SECRET is unset', async () => {
    const res = await getMe(
      new Request('http://localhost/api/auth/me'),
      { secret: '' },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      authNotConfigured?: boolean;
    };
    expect(body.authenticated).toBe(false);
    expect(body.authNotConfigured).toBe(true);
  });

  test('401 when secret is set but no session cookie', async () => {
    const res = await getMe(
      new Request('http://localhost/api/auth/me'),
      { secret: SECRET },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });

  test('200 with username when session cookie is valid', async () => {
    const token = await signSessionToken(SECRET, {
      sub: 'u-1',
      username: 'alice',
    });
    const res = await getMe(
      new Request('http://localhost/api/auth/me', {
        headers: { Cookie: `${sessionCookieName()}=${encodeURIComponent(token)}` },
      }),
      { secret: SECRET },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      user: { username: string };
    };
    expect(body.authenticated).toBe(true);
    expect(body.user.username).toBe('alice');
  });
});

// ---------------------------------------------------------------------------
// /api/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  test('503 when AUTH_JWT_SECRET is unset', async () => {
    const { handle } = createTestDbWithUser();
    const res = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: 'tester', password: 'pw' }),
      }),
      { db: handle.db, secret: '' },
    );
    expect(res.status).toBe(503);
  });

  test('400 on invalid JSON', async () => {
    const { handle } = createTestDbWithUser();
    const res = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: 'not-json{',
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(400);
  });

  test('400 when username or password is missing', async () => {
    const { handle } = createTestDbWithUser();
    const res = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: '   ', password: '' }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(400);
  });

  test('401 when username unknown', async () => {
    const { handle } = createTestDbWithUser();
    const res = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'nobody',
          password: 'whatever',
        }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('401 when password is wrong', async () => {
    const realHash = await hashPassword('correct-pw');
    const { handle } = createTestDbWithUser({
      userId: 'u-real',
      username: 'realuser',
      passwordHash: realHash,
    });
    const res = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'realuser',
          password: 'wrong-pw',
        }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(401);
  });

  test('200 with Set-Cookie when credentials are valid', async () => {
    const realHash = await hashPassword('s3cret-pw');
    const { handle } = createTestDbWithUser({
      userId: 'u-ok',
      username: 'okuser',
      passwordHash: realHash,
    });
    const res = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'okuser',
          password: 's3cret-pw',
        }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('sb_session=');
    expect(cookie).toContain('HttpOnly');
    const body = (await res.json()) as {
      ok: boolean;
      user: { username: string };
    };
    expect(body.ok).toBe(true);
    expect(body.user.username).toBe('okuser');
  });

  test('username match is case-insensitive (parity with D1 COLLATE NOCASE)', async () => {
    const realHash = await hashPassword('pw');
    const { handle } = createTestDbWithUser({
      userId: 'u-ci',
      username: 'MixedCase',
      passwordHash: realHash,
    });
    const res = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'mixedcase',
          password: 'pw',
        }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
  });

  // Pentest L-09: the lower(username) compare runs on the raw submitted bytes.
  // Unicode has multiple byte sequences that render identically (full-width
  // forms, compatibility characters, etc.). NFKC-normalizing the submitted
  // username before the lookup collapses those equivalents onto the canonical
  // ASCII form a user was seeded with, closing the normalization collision
  // class. Full-width "ａｄｍｉｎ" → NFKC → "admin".
  test('NFKC-equivalent username resolves the same stored user (L-09)', async () => {
    const realHash = await hashPassword('pw');
    const { handle } = createTestDbWithUser({
      userId: 'u-nfkc',
      username: 'admin',
      passwordHash: realHash,
    });
    const fullWidthAdmin = 'ａｄｍｉｎ'; // U+FF41.. full-width latin, NFKC → "admin"
    expect(fullWidthAdmin).not.toBe('admin'); // guard: genuinely different bytes
    const res = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: fullWidthAdmin,
          password: 'pw',
        }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
  });

  test('plain ASCII "admin" login is unaffected by NFKC normalization (L-09)', async () => {
    const realHash = await hashPassword('pw');
    const { handle } = createTestDbWithUser({
      userId: 'u-admin',
      username: 'admin',
      passwordHash: realHash,
    });
    const res = await postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: 'admin',
          password: 'pw',
        }),
      }),
      { db: handle.db, secret: SECRET },
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// /api/auth/logout
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout', () => {
  test('returns 204 + Set-Cookie that clears sb_session', async () => {
    const res = await postLogout(
      new Request('http://localhost/api/auth/logout', { method: 'POST' }),
    );
    expect(res.status).toBe(204);
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('sb_session=;');
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('HttpOnly');
  });

  test('emits Secure flag when request URL is https', async () => {
    const res = await postLogout(
      new Request('https://example.com/api/auth/logout', { method: 'POST' }),
    );
    const cookie = res.headers.get('set-cookie');
    expect(cookie).toContain('Secure');
  });
});

// ---------------------------------------------------------------------------
// Pentest H-02: Login rate limiting
// ---------------------------------------------------------------------------

describe('POST /api/auth/login — rate limiting (H-02)', () => {
  async function loginAttempt(
    username: string,
    password: string,
    db: ReturnType<typeof createTestDbWithUser>['handle']['db'],
    rateLimiter: ReturnType<typeof createMemoryRateLimiter>,
  ): Promise<Response> {
    return postLogin(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
        headers: { 'Content-Type': 'application/json' },
      }),
      { db, secret: SECRET, rateLimiter },
    );
  }

  test('5 wrong-password attempts return 401, 6th returns 429', async () => {
    const { handle } = createTestDbWithUser({
      userId: 'u-rl',
      username: 'rluser',
      passwordHash: await hashPassword('correct-pw'),
    });
    const limiter = createMemoryRateLimiter();

    // Attempts 1–5: wrong password, should be 401 (not rate-limited yet).
    for (let i = 0; i < 5; i++) {
      const res = await loginAttempt('rluser', 'wrong-pw', handle.db, limiter);
      expect(res.status).toBe(401);
    }

    // 6th attempt: rate limited — 429 with Retry-After header.
    const blocked = await loginAttempt('rluser', 'wrong-pw', handle.db, limiter);
    expect(blocked.status).toBe(429);
    const retryAfter = blocked.headers.get('Retry-After');
    expect(retryAfter).not.toBeNull();
    expect(Number(retryAfter)).toBeGreaterThan(0);

    const body = (await blocked.json()) as { error: string };
    expect(body.error).toBe('rate_limited');
  });

  test('rate limit is per-username: different usernames have independent buckets', async () => {
    const hashA = await hashPassword('pw-a');
    const hashB = await hashPassword('pw-b');
    const { handle } = createTestDbWithUser({
      userId: 'u-alpha',
      username: 'alpha',
      passwordHash: hashA,
    });
    // Seed a second user.
    handle.mem.public.none(
      `INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('u-beta', 'beta', '${hashB}', '2026-01-01T00:00:00Z')`,
    );

    const limiter = createMemoryRateLimiter();

    // Exhaust the rate limit for 'alpha'.
    for (let i = 0; i < 5; i++) {
      await loginAttempt('alpha', 'wrong', handle.db, limiter);
    }
    const alphaBlocked = await loginAttempt('alpha', 'wrong', handle.db, limiter);
    expect(alphaBlocked.status).toBe(429);

    // 'beta' has an independent bucket — still allowed.
    const betaOk = await loginAttempt('beta', 'wrong', handle.db, limiter);
    expect(betaOk.status).toBe(401);
  });

  test('resetForTests re-allows a previously exhausted username', async () => {
    const { handle } = createTestDbWithUser({
      userId: 'u-reset',
      username: 'resetuser',
      passwordHash: await hashPassword('pw'),
    });
    const limiter = createMemoryRateLimiter();

    // Exhaust the limit.
    for (let i = 0; i < 5; i++) {
      await loginAttempt('resetuser', 'wrong', handle.db, limiter);
    }
    const blocked = await loginAttempt('resetuser', 'wrong', handle.db, limiter);
    expect(blocked.status).toBe(429);

    // After reset the bucket is cleared.
    limiter.resetForTests();
    const allowed = await loginAttempt('resetuser', 'wrong', handle.db, limiter);
    expect(allowed.status).toBe(401); // Wrong password, but not rate-limited.
  });

  test('rate limit fires BEFORE DB lookup (blocks even with correct credentials once exhausted)', async () => {
    const realHash = await hashPassword('correct-pw');
    const { handle } = createTestDbWithUser({
      userId: 'u-bypass',
      username: 'bypassuser',
      passwordHash: realHash,
    });
    const limiter = createMemoryRateLimiter();

    // Exhaust the limit with wrong-password attempts.
    for (let i = 0; i < 5; i++) {
      await loginAttempt('bypassuser', 'wrong', handle.db, limiter);
    }

    // Even a correct password is blocked because the per-username limit is hit.
    const res = await loginAttempt('bypassuser', 'correct-pw', handle.db, limiter);
    expect(res.status).toBe(429);
  });
});
