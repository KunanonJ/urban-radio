// @vitest-environment node

/**
 * Unit tests for the in-memory fixed-window rate limiter.
 *
 * Tests use an injected `now` clock so no real time needs to elapse.
 * All tests are fully deterministic and run in isolation via resetForTests().
 */

import { describe, expect, test, beforeEach } from 'vitest';

import {
  createMemoryRateLimiter,
  defaultRateLimiter,
  extractIp,
  type RateLimitConfig,
} from './rate-limit';

// ---------------------------------------------------------------------------
// createMemoryRateLimiter — isolated instances per describe block
// ---------------------------------------------------------------------------

describe('createMemoryRateLimiter', () => {
  // Fixed clock: all calls in the first window share t=0 ms.
  const T0 = 1_000_000;
  let tick = T0;

  function now(): number {
    return tick;
  }

  function cfg(capacity: number, windowSec: number): RateLimitConfig {
    return { capacity, windowSec, now };
  }

  beforeEach(() => {
    tick = T0;
  });

  test('allows exactly capacity requests then blocks the next one', () => {
    const limiter = createMemoryRateLimiter();
    const key = 'test-key';
    const config = cfg(5, 60);

    for (let i = 0; i < 5; i++) {
      const result = limiter.consume(key, config);
      expect(result.allowed).toBe(true);
    }

    const blocked = limiter.consume(key, config);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  test('remaining decrements correctly as requests are consumed', () => {
    const limiter = createMemoryRateLimiter();
    const key = 'remaining-key';
    const config = cfg(3, 60);

    const r1 = limiter.consume(key, config);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.consume(key, config);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.consume(key, config);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = limiter.consume(key, config);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  test('refills after the window elapses (injected clock)', () => {
    const limiter = createMemoryRateLimiter();
    const key = 'refill-key';
    const config = cfg(2, 60);

    // Consume both slots in window 1.
    limiter.consume(key, config);
    limiter.consume(key, config);

    // Advance clock past the 60-second window boundary.
    tick = T0 + 61_000;

    // Should be allowed again — window reset.
    const r = limiter.consume(key, config);
    expect(r.allowed).toBe(true);
  });

  test('retryAfterSec is positive and reflects time until window end', () => {
    const limiter = createMemoryRateLimiter();
    const key = 'retry-key';
    const config = cfg(1, 60);

    // Consume the only slot at T0.
    limiter.consume(key, config);

    // Advance 10 seconds into the window.
    tick = T0 + 10_000;
    const blocked = limiter.consume(key, config);
    expect(blocked.allowed).toBe(false);
    // 60 seconds window - 10 seconds elapsed = ~50 seconds remaining.
    expect(blocked.retryAfterSec).toBe(50);
  });

  test('different keys are independent buckets', () => {
    const limiter = createMemoryRateLimiter();
    const config = cfg(1, 60);

    const r1 = limiter.consume('key-alpha', config);
    expect(r1.allowed).toBe(true);

    // 'key-alpha' is now exhausted — 'key-beta' is a separate bucket.
    const r2 = limiter.consume('key-beta', config);
    expect(r2.allowed).toBe(true);

    // 'key-alpha' is blocked, 'key-beta' is still fresh after the first r2 call.
    const r3 = limiter.consume('key-alpha', config);
    expect(r3.allowed).toBe(false);
  });

  test('resetForTests clears all buckets so subsequent requests succeed', () => {
    const limiter = createMemoryRateLimiter();
    const key = 'reset-key';
    const config = cfg(1, 60);

    limiter.consume(key, config); // consume the only slot

    const blocked = limiter.consume(key, config);
    expect(blocked.allowed).toBe(false);

    // After reset all buckets are wiped.
    limiter.resetForTests();

    const allowed = limiter.consume(key, config);
    expect(allowed.allowed).toBe(true);
  });

  test('capacity=1 blocks immediately after first request', () => {
    const limiter = createMemoryRateLimiter();
    const config = cfg(1, 60);

    const r1 = limiter.consume('cap1', config);
    expect(r1.allowed).toBe(true);

    const r2 = limiter.consume('cap1', config);
    expect(r2.allowed).toBe(false);
  });

  test('window boundary at exactly windowSec seconds resets the bucket', () => {
    const limiter = createMemoryRateLimiter();
    const key = 'boundary-key';
    const config = cfg(1, 30);

    // Consume the slot.
    limiter.consume(key, config);

    // At exactly 30 000 ms the window has elapsed (>= windowSec * 1000).
    tick = T0 + 30_000;
    const r = limiter.consume(key, config);
    expect(r.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// defaultRateLimiter — module singleton
// ---------------------------------------------------------------------------

describe('defaultRateLimiter', () => {
  beforeEach(() => {
    defaultRateLimiter.resetForTests();
  });

  test('resetForTests wipes all buckets and allows fresh requests', () => {
    const key = 'singleton-key';
    const config: RateLimitConfig = { capacity: 1, windowSec: 60 };

    defaultRateLimiter.consume(key, config); // exhausts the slot
    defaultRateLimiter.resetForTests();
    const result = defaultRateLimiter.consume(key, config);
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractIp helper
// ---------------------------------------------------------------------------

describe('extractIp', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('http://localhost/', { headers });
  }

  test('returns first hop of X-Forwarded-For', () => {
    const req = makeRequest({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' });
    expect(extractIp(req)).toBe('203.0.113.5');
  });

  test('trims whitespace from X-Forwarded-For first hop', () => {
    const req = makeRequest({ 'x-forwarded-for': ' 1.2.3.4 , 5.6.7.8' });
    expect(extractIp(req)).toBe('1.2.3.4');
  });

  test('falls back to cf-connecting-ip when XFF is absent', () => {
    const req = makeRequest({ 'cf-connecting-ip': '198.51.100.42' });
    expect(extractIp(req)).toBe('198.51.100.42');
  });

  test('returns "unknown" when neither header is present', () => {
    const req = makeRequest({});
    expect(extractIp(req)).toBe('unknown');
  });

  test('prefers X-Forwarded-For over cf-connecting-ip', () => {
    const req = makeRequest({
      'x-forwarded-for': '203.0.113.1',
      'cf-connecting-ip': '198.51.100.1',
    });
    expect(extractIp(req)).toBe('203.0.113.1');
  });
});
