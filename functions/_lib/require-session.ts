/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from './env';
import { getSessionFromRequest } from './session-jwt';

function apiPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

export function isPublicApiRoute(pathname: string, method: string): boolean {
  if (method === 'OPTIONS') return true;
  if (pathname === '/api/health') return true;
  // Phase 8 — public monitoring + integration endpoints.
  if (pathname === '/api/healthz') return true;
  if (pathname === '/api/status') return true;
  if (pathname === '/api/webhooks/stripe' && method === 'POST') return true;
  if (pathname === '/api/auth/login' && method === 'POST') return true;
  if (pathname === '/api/auth/logout' && method === 'POST') return true;
  if (pathname === '/api/auth/me' && method === 'GET') return true;
  return false;
}

/**
 * When `AUTH_JWT_SECRET` is set, requires a valid session (Bearer or `sb_session` cookie)
 * except for public routes. When unset, returns `null` (no gate).
 */
export async function requireAppSession(
  request: Request,
  env: SonicBloomEnv,
): Promise<Response | null> {
  const secret = env.AUTH_JWT_SECRET?.trim();
  if (!secret) return null;

  const method = request.method;
  const pathname = apiPathname(request.url);
  if (isPublicApiRoute(pathname, method)) return null;

  const session = await getSessionFromRequest(request, secret);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  return null;
}
