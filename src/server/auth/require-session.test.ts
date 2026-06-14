// @vitest-environment node
// `jose` autoloads its `webapi` build under jsdom; that build's
// `instanceof Uint8Array` checks fail across realms. Run in node.

import { describe, expect, test } from 'vitest';

import {
  isPublicApiRoute,
  requireAppSession,
} from './require-session';
import { signSessionToken } from './session-jwt';

const SECRET = 'test-secret-do-not-use-in-prod';

describe('isPublicApiRoute', () => {
  test('OPTIONS is always public', () => {
    expect(isPublicApiRoute('/api/anything', 'OPTIONS')).toBe(true);
  });

  test('health + healthz + status are GET-public', () => {
    expect(isPublicApiRoute('/api/health', 'GET')).toBe(true);
    expect(isPublicApiRoute('/api/healthz', 'GET')).toBe(true);
    expect(isPublicApiRoute('/api/status', 'GET')).toBe(true);
  });

  test('auth endpoints are public on their expected method only', () => {
    expect(isPublicApiRoute('/api/auth/login', 'POST')).toBe(true);
    expect(isPublicApiRoute('/api/auth/login', 'GET')).toBe(false);
    expect(isPublicApiRoute('/api/auth/me', 'GET')).toBe(true);
    expect(isPublicApiRoute('/api/auth/me', 'DELETE')).toBe(false);
  });

  test('stripe webhook is public on POST only', () => {
    expect(isPublicApiRoute('/api/webhooks/stripe', 'POST')).toBe(true);
    expect(isPublicApiRoute('/api/webhooks/stripe', 'GET')).toBe(false);
  });

  test('everything else is private', () => {
    expect(isPublicApiRoute('/api/clocks', 'GET')).toBe(false);
    expect(isPublicApiRoute('/api/voice-tracks', 'POST')).toBe(false);
  });
});

describe('requireAppSession', () => {
  test('returns null when secret is unset in non-production env (dev allow-through)', async () => {
    const original = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    try {
      const request = new Request('http://localhost/api/clocks');
      const deny = await requireAppSession(request, { secret: '' });
      expect(deny).toBeNull();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = original;
    }
  });

  test('FAIL-CLOSED in production when secret is unset (returns 503)', async () => {
    // Pentest C-01: `AUTH_JWT_SECRET` unset must never silently disable auth
    // in production. The middleware must short-circuit with 503 so a missing
    // env var is loud, not silent.
    const original = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    try {
      const request = new Request('http://localhost/api/clocks');
      const deny = await requireAppSession(request, { secret: '' });
      expect(deny).not.toBeNull();
      expect(deny?.status).toBe(503);
      const body = (await deny!.json()) as { error: string };
      expect(body.error).toMatch(/AUTH_JWT_SECRET/);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = original;
    }
  });

  test('FAIL-CLOSED in production allows public routes even when secret unset', async () => {
    // Health probes must remain reachable even if auth is broken,
    // otherwise uptime monitors will alarm on every config drift.
    const original = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    try {
      const request = new Request('http://localhost/api/healthz');
      const deny = await requireAppSession(request, { secret: '' });
      expect(deny).toBeNull();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = original;
    }
  });

  test('returns null for public routes even without a session', async () => {
    const request = new Request('http://localhost/api/health');
    const deny = await requireAppSession(request, { secret: SECRET });
    expect(deny).toBeNull();
  });

  test('returns 401 for protected routes without a session', async () => {
    const request = new Request('http://localhost/api/clocks');
    const deny = await requireAppSession(request, { secret: SECRET });
    expect(deny).not.toBeNull();
    expect(deny?.status).toBe(401);
  });

  test('returns null for protected route with valid session cookie', async () => {
    const token = await signSessionToken(SECRET, {
      sub: 'u',
      username: 'tester',
    });
    const request = new Request('http://localhost/api/clocks', {
      headers: { Cookie: `sb_session=${encodeURIComponent(token)}` },
    });
    const deny = await requireAppSession(request, { secret: SECRET });
    expect(deny).toBeNull();
  });
});
