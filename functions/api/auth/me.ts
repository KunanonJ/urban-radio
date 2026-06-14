/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { getSessionFromRequest } from '../../_lib/session-jwt';

type Ctx = { env: SonicBloomEnv; request: Request };

export async function onRequestGet(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const secret = env.AUTH_JWT_SECRET?.trim();
  if (!secret) {
    return Response.json({ authenticated: false, authNotConfigured: true });
  }

  const session = await getSessionFromRequest(request, secret);
  if (!session?.username) {
    return Response.json({ authenticated: false }, { status: 401 });
  }

  return Response.json({ authenticated: true, user: { username: session.username } });
}
