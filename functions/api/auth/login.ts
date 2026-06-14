/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { verifyPassword } from '../../_lib/password';
import { signSessionToken, buildSessionSetCookie } from '../../_lib/session-jwt';

type Ctx = { env: SonicBloomEnv; request: Request };

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const secret = env.AUTH_JWT_SECRET?.trim();
  if (!secret) {
    return Response.json({ error: 'AUTH_JWT_SECRET is not configured' }, { status: 503 });
  }

  if (!env.DB) {
    return Response.json({ error: 'Database unavailable' }, { status: 503 });
  }

  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return Response.json({ error: 'Username and password are required' }, { status: 400 });
  }

  const row = await env.DB.prepare(
    'SELECT id, password_hash FROM auth_users WHERE username = ? COLLATE NOCASE LIMIT 1',
  )
    .bind(username)
    .first<{ id: string; password_hash: string }>();

  if (!row || !(await verifyPassword(password, row.password_hash))) {
    return Response.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  const token = await signSessionToken(secret, { sub: row.id, username });
  const cookie = buildSessionSetCookie(token, request, 7 * 24 * 60 * 60);

  return Response.json(
    { ok: true, user: { username } },
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': cookie,
      },
    },
  );
}
