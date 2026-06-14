/**
 * GET /api/auth/me — current session probe.
 *
 * Mirrors `functions/api/auth/me.ts`. Returns:
 *   200 { authenticated: true, user: { username } }
 *   401 { authenticated: false }
 *   200 { authenticated: false, authNotConfigured: true } when AUTH_JWT_SECRET is unset
 *
 * Public per `requireAppSession.isPublicApiRoute`.
 */

import { jsonOk } from '@/server/api-response';
import { getSessionFromRequest } from '@/server/auth/session-jwt';

interface MeDeps {
  secret?: string;
}

export async function getMe(
  request: Request,
  deps: MeDeps = {},
): Promise<Response> {
  const secret = (deps.secret ?? process.env.AUTH_JWT_SECRET ?? '').trim();
  if (!secret) {
    return jsonOk({ authenticated: false, authNotConfigured: true });
  }

  const session = await getSessionFromRequest(request, secret);
  if (!session?.username) {
    return jsonOk({ authenticated: false }, { status: 401 });
  }

  return jsonOk({
    authenticated: true,
    user: { username: session.username },
  });
}

export async function GET(request: Request): Promise<Response> {
  return getMe(request);
}
