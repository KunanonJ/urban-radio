/**
 * POST /api/auth/logout — clears the `sb_session` cookie.
 *
 * Mirrors `functions/api/auth/logout.ts`. Returns 204 with `Set-Cookie`
 * carrying Max-Age=0. Public per `requireAppSession.isPublicApiRoute`.
 */

import { buildSessionClearCookie } from '@/server/auth/session-jwt';

export async function postLogout(request: Request): Promise<Response> {
  const clear = buildSessionClearCookie(request);
  return new Response(null, {
    status: 204,
    headers: { 'Set-Cookie': clear },
  });
}

export async function POST(request: Request): Promise<Response> {
  return postLogout(request);
}
