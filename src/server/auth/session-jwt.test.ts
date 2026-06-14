// @vitest-environment node

/**
 * Cookie-flag tests for pentest M-03.
 *
 * The `Secure` flag must:
 *   - be ON when X-Forwarded-Proto says https (reverse-proxy case)
 *   - be ON unconditionally in production (defense-in-depth)
 *   - be OFF when the upstream request is plain http and no XFP header
 *     is present and NODE_ENV !== production (local dev)
 *
 * Token verification timing oracle / JWT correctness is covered by the
 * existing require-station / require-session tests.
 */

import { afterEach, describe, expect, test } from 'vitest';

import {
  buildSessionClearCookie,
  buildSessionSetCookie,
} from './session-jwt';

const originalEnv = process.env.NODE_ENV;

afterEach(() => {
  (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
});

function withNodeEnv(value: string): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

describe('buildSessionSetCookie', () => {
  test('Secure flag set in production regardless of request protocol', () => {
    withNodeEnv('production');
    const request = new Request('http://upstream-from-proxy/foo');
    const cookie = buildSessionSetCookie('tok', request, 3600);
    expect(cookie).toContain('Secure');
  });

  test('Secure flag set when X-Forwarded-Proto = https (dev too)', () => {
    withNodeEnv('test');
    const request = new Request('http://upstream/foo', {
      headers: { 'X-Forwarded-Proto': 'https' },
    });
    const cookie = buildSessionSetCookie('tok', request, 3600);
    expect(cookie).toContain('Secure');
  });

  test('Secure flag respects the FIRST hop in multi-proxy XFP chain', () => {
    withNodeEnv('test');
    const request = new Request('http://upstream/foo', {
      headers: { 'X-Forwarded-Proto': 'https, http' },
    });
    const cookie = buildSessionSetCookie('tok', request, 3600);
    expect(cookie).toContain('Secure');
  });

  test('Secure flag dropped in dev when XFP=http and request URL is http', () => {
    withNodeEnv('development');
    const request = new Request('http://localhost/foo', {
      headers: { 'X-Forwarded-Proto': 'http' },
    });
    const cookie = buildSessionSetCookie('tok', request, 3600);
    expect(cookie).not.toContain('Secure');
  });

  test('Secure flag set in dev when request URL is https (no XFP)', () => {
    withNodeEnv('development');
    const request = new Request('https://localhost/foo');
    const cookie = buildSessionSetCookie('tok', request, 3600);
    expect(cookie).toContain('Secure');
  });

  test('Cookie carries HttpOnly + SameSite=Lax + Path=/ + Max-Age', () => {
    const request = new Request('http://localhost/foo');
    const cookie = buildSessionSetCookie('tok-value', request, 3600);
    expect(cookie).toContain('sb_session=tok-value');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=3600');
  });
});

describe('buildSessionClearCookie', () => {
  test('produces Max-Age=0 + same Secure logic', () => {
    withNodeEnv('production');
    const request = new Request('http://upstream-from-proxy/foo');
    const cookie = buildSessionClearCookie(request);
    expect(cookie).toContain('Max-Age=0');
    expect(cookie).toContain('Secure');
  });
});
