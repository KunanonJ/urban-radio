/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { buildSessionClearCookie } from '../../_lib/session-jwt';

type Ctx = { env: SonicBloomEnv; request: Request };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { request } = ctx;
  const clear = buildSessionClearCookie(request);
  return new Response(null, {
    status: 204,
    headers: {
      'Set-Cookie': clear,
    },
  });
}
