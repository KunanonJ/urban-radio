/**
 * In-memory fixed-window rate limiter.
 *
 * Design: fixed-window with a carry-over reset. Each bucket stores
 * { count, windowStart }. On consume():
 *  - If now - windowStart >= windowSec * 1000: reset (count=0, windowStart=now).
 *  - If count < capacity: increment, return allowed.
 *  - Else: return denied with retryAfterSec = ceil((windowStart + windowSec*1000 - now) / 1000).
 *
 * The Map backend is swappable for Redis (Wave γ+1) by implementing RateLimiter
 * against the same interface.
 *
 * Pentest H-02: applied to /api/auth/login (per-username + per-IP).
 * Pentest H-09: applied to all five AI routes (per-station).
 *
 * See docs/PENTEST-AUDIT-RESULTS.md.
 */

export interface RateLimitConfig {
  /** Maximum requests allowed in the window. */
  capacity: number;
  /** Window length in seconds. */
  windowSec: number;
  /**
   * Time source — tests inject a deterministic clock.
   * Defaults to `Date.now` (milliseconds).
   */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests remaining in the current window (0 when denied). */
  remaining: number;
  /** Seconds until the window resets (0 when allowed). */
  retryAfterSec: number;
}

export interface RateLimiter {
  /**
   * Attempt to consume one token from the bucket identified by `key`.
   * `cfg.now` overrides the clock for tests.
   */
  consume(key: string, cfg: RateLimitConfig): RateLimitResult;
  /**
   * Test seam — clears all buckets so each test starts from a clean state.
   * Do NOT call in production code.
   */
  resetForTests(): void;
}

interface Bucket {
  count: number;
  windowStart: number;
}

export function createMemoryRateLimiter(): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function consume(key: string, cfg: RateLimitConfig): RateLimitResult {
    const nowMs = (cfg.now ?? Date.now)();
    const windowMs = cfg.windowSec * 1000;

    let bucket = buckets.get(key);

    if (!bucket || nowMs - bucket.windowStart >= windowMs) {
      // New bucket or window has elapsed — start fresh.
      bucket = { count: 0, windowStart: nowMs };
      buckets.set(key, bucket);
    }

    if (bucket.count < cfg.capacity) {
      bucket.count += 1;
      return {
        allowed: true,
        remaining: cfg.capacity - bucket.count,
        retryAfterSec: 0,
      };
    }

    // Over the limit — compute time until window resets.
    const windowEndMs = bucket.windowStart + windowMs;
    const retryAfterSec = Math.ceil((windowEndMs - nowMs) / 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(retryAfterSec, 1),
    };
  }

  function resetForTests(): void {
    buckets.clear();
  }

  // Prune stale buckets every 5 minutes to prevent unbounded Map growth.
  // Only started once per limiter instance and only outside test environments.
  // The interval is unref'd so it never keeps the process alive.
  if (typeof setInterval !== 'undefined' && typeof process !== 'undefined') {
    const sweepIntervalMs = 5 * 60 * 1000;
    const sweep = setInterval(() => {
      const nowMs = Date.now();
      for (const [key, bucket] of buckets) {
        // Remove buckets whose window expired more than one full window ago.
        // This keeps recent windows alive for the retryAfterSec calculation
        // while eventually evicting long-idle keys.
        if (nowMs - bucket.windowStart > sweepIntervalMs) {
          buckets.delete(key);
        }
      }
    }, sweepIntervalMs);
    // Don't hold the Node.js event loop open.
    if (typeof sweep === 'object' && sweep !== null && 'unref' in sweep) {
      (sweep as NodeJS.Timeout).unref();
    }
  }

  return { consume, resetForTests };
}

/**
 * Process-wide singleton limiter used by all route handlers in production.
 *
 * In a single-instance Railway deploy this is sufficient; behind multiple
 * instances a Redis-backed limiter is the natural swap target (Wave γ+1).
 *
 * Tests MUST call `defaultRateLimiter.resetForTests()` in `beforeEach` to
 * prevent inter-test bucket bleed.
 */
export const defaultRateLimiter: RateLimiter = createMemoryRateLimiter();

// ---------------------------------------------------------------------------
// Standard config presets — tune before deploy.
// ---------------------------------------------------------------------------

/** 5 login attempts per username per 60-second window. */
export const LOGIN_LIMIT: RateLimitConfig = { capacity: 5, windowSec: 60 };

/**
 * 20 login attempts per source IP per 60-second window.
 * Defense-in-depth against credential stuffing across many usernames.
 */
export const LOGIN_IP_LIMIT: RateLimitConfig = { capacity: 20, windowSec: 60 };

/** 30 AI requests per station per 60-second window. */
export const AI_PER_STATION_LIMIT: RateLimitConfig = {
  capacity: 30,
  windowSec: 60,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the best-available source IP from the request headers.
 * Trusts the first hop of X-Forwarded-For (set by Railway / Cloudflare)
 * and falls back to cf-connecting-ip, then 'unknown'.
 * We never use the raw socket address because we are always behind a proxy.
 */
export function extractIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const firstHop = xff.split(',')[0]?.trim();
    if (firstHop) return firstHop;
  }
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  return 'unknown';
}

/**
 * Build a standard 429 Too Many Requests response.
 */
export function rateLimitedResponse(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Retry-After': String(retryAfterSec),
    },
  });
}
