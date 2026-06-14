/// <reference types="@cloudflare/workers-types" />

import type { PagesFunction } from '@cloudflare/workers-types';
import type { SonicBloomEnv } from '../_lib/env';
import { requireCfAccessJwt } from '../_lib/access-jwt';
import { requireAppSession } from '../_lib/require-session';

/**
 * Order: Cloudflare Access (optional) → app session JWT (optional) → handler.
 */
export const onRequest: PagesFunction<SonicBloomEnv> = async (context) => {
  const { request, env, next } = context;
  const access = await requireCfAccessJwt(request, env);
  if (!access.ok) {
    return new Response(access.body, {
      status: access.status,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  const sessionDeny = await requireAppSession(request, env);
  if (sessionDeny) return sessionDeny;
  return next();
};
