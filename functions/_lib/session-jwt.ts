/// <reference types="@cloudflare/workers-types" />

import { SignJWT, jwtVerify } from 'jose';

const issuer = 'sonic-bloom';
const audience = 'sonic-bloom-app';

export async function signSessionToken(
  secret: string,
  payload: { sub: string; username: string },
): Promise<string> {
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(secret));
}

export async function verifySessionToken(
  secret: string,
  token: string,
): Promise<{ sub: string; username: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer,
      audience,
      algorithms: ['HS256'],
    });
    return {
      sub: String(payload.sub ?? ''),
      username: String((payload as { username?: string }).username ?? ''),
    };
  } catch {
    return null;
  }
}

function getBearerToken(request: Request): string | null {
  const h = request.headers.get('Authorization');
  if (!h?.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return t || null;
}

function getCookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get('Cookie');
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

const SESSION_COOKIE = 'sb_session';

export async function getSessionFromRequest(request: Request, secret: string): Promise<{ sub: string; username: string } | null> {
  const token = getBearerToken(request) ?? getCookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  return verifySessionToken(secret, token);
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

export function buildSessionSetCookie(token: string, request: Request, maxAgeSec: number): string {
  const secure = new URL(request.url).protocol === 'https:';
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function buildSessionClearCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:';
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
