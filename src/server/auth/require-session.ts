/**
 * Lightweight session gate for the Next.js middleware.
 *
 * Mirrors `functions/_lib/require-session.ts`. The middleware only needs to
 * know whether a request has a valid app session — station membership is
 * resolved per-handler via `requireStation`.
 *
 * When `AUTH_JWT_SECRET` is unset, the gate is disabled (returns `null`) so
 * local dev without auth keeps working. This matches the Cloudflare side.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { jsonError } from '@/server/api-response';

import { getSessionFromRequest } from './session-jwt';

function apiPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/**
 * Returns `true` for routes that bypass the session gate entirely. Mirrors
 * the legacy Cloudflare allow-list — adding to it requires a paired update.
 */
export function isPublicApiRoute(pathname: string, method: string): boolean {
  if (method === 'OPTIONS') return true;
  if (pathname === '/api/health') return true;
  if (pathname === '/api/healthz') return true;
  if (pathname === '/api/status') return true;
  if (pathname === '/api/webhooks/stripe' && method === 'POST') return true;
  if (pathname === '/api/auth/login' && method === 'POST') return true;
  if (pathname === '/api/auth/logout' && method === 'POST') return true;
  if (pathname === '/api/auth/me' && method === 'GET') return true;
  return false;
}

export interface RequireSessionOptions {
  /** Override the JWT secret (defaults to `process.env.AUTH_JWT_SECRET`). */
  secret?: string;
}

/**
 * Returns a `Response` to short-circuit unauthenticated requests, or `null`
 * to allow the request through.
 *
 * **Fail-closed in production (pentest C-01).** When `AUTH_JWT_SECRET` is
 * unset:
 *   - In non-production envs (test / development): returns `null` so local
 *     dev without auth keeps working. This matches the legacy Cloudflare
 *     dev contract.
 *   - In production: short-circuits with **503** for every non-public route.
 *     A missing secret variable would otherwise silently disable the entire
 *     auth subsystem — making one config typo equal to a full data breach.
 *
 * Public routes (`/api/healthz`, `/api/auth/login`, etc.) remain reachable
 * even when the secret is missing so uptime probes don't alarm on every
 * config drift.
 */
export async function requireAppSession(
  request: Request,
  opts: RequireSessionOptions = {},
): Promise<Response | null> {
  const secret = (opts.secret ?? process.env.AUTH_JWT_SECRET ?? '').trim();
  const method = request.method;
  const pathname = apiPathname(request.url);

  if (!secret) {
    if (isPublicApiRoute(pathname, method)) return null;
    if (process.env.NODE_ENV === 'production') {
      return jsonError(503, 'AUTH_JWT_SECRET not configured');
    }
    return null; // dev / test allow-through
  }

  if (isPublicApiRoute(pathname, method)) return null;

  const session = await getSessionFromRequest(request, secret);
  if (!session) return jsonError(401, 'Unauthorized');
  return null;
}
