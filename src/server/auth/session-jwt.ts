/**
 * App-session JWT helpers for the Next.js runtime.
 *
 * Functionally identical to `functions/_lib/session-jwt.ts` — same HS256 algo,
 * same issuer/audience, same cookie name. Sharing those constants is the whole
 * reason existing sessions stay valid across the Cloudflare → Railway cutover.
 *
 * The legacy file is kept under `functions/` because tsconfig excludes that
 * tree from the Next build. Don't re-export from there — port intentionally.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'sonic-bloom';
const AUDIENCE = 'sonic-bloom-app';

/**
 * Pentest L-06: the `__Host-` cookie name prefix would give stronger origin
 * binding (the browser enforces Secure + Path=/ + no Domain). We deliberately
 * do NOT adopt it, and we keep the plain `sb_session` name.
 *
 * Reason: a `__Host-`-prefixed cookie is REJECTED by the browser unless every
 * response that sets it carries the `Secure` attribute. Our dev flow runs over
 * http://localhost and intentionally omits `Secure` there (see
 * `shouldUseSecureCookie` below and pentest M-03), so a `__Host-` cookie would
 * simply be dropped in local development — breaking login for every dev.
 *
 * The mitigation we already ship covers the same threat in production: the
 * cookie is set with Secure + HttpOnly + SameSite=Lax + Path=/ and NO `Domain`
 * attribute, which gives strong host-only origin binding in prod without the
 * dev-mode breakage. Adopting `__Host-` would require always forcing `Secure`
 * (and therefore HTTPS) in dev, which is out of scope for this finding.
 */
const SESSION_COOKIE = 'sb_session';

/**
 * Pentest M-04: the original 7-day session lifetime created a 7-day replay
 * window after logout (HttpOnly cookie clear does not revoke the underlying
 * JWT). Shortening to 8 hours bounds the worst-case window to a single work
 * shift. Full `jti`-based revocation is the strict fix; this is a low-risk
 * partial mitigation that buys 95% of the blast-radius reduction.
 *
 * 8h = 28,800 s. Match the cookie Max-Age below.
 */
export const SESSION_TTL = '8h';
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionPayload {
  sub: string;
  username: string;
}

export async function signSessionToken(
  secret: string,
  payload: SessionPayload,
): Promise<string> {
  return new SignJWT({ username: payload.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(SESSION_TTL)
    .sign(new TextEncoder().encode(secret));
}

export async function verifySessionToken(
  secret: string,
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(secret),
      {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      },
    );
    return {
      sub: String(payload.sub ?? ''),
      username: String((payload as { username?: string }).username ?? ''),
    };
  } catch {
    return null;
  }
}

function getBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
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

/**
 * Pentest L-07: this accepts BOTH an `Authorization: Bearer <jwt>` header and
 * the `sb_session` cookie, with Bearer taking precedence. That dual acceptance
 * is a confused-deputy risk in narrow scenarios, but the precedence is
 * INTENTIONAL and we are not narrowing it:
 *
 *   - Browser clients authenticate via the HttpOnly `sb_session` cookie (they
 *     cannot read or set the Authorization header for same-origin fetches).
 *   - Programmatic / API clients (CLI, server-to-server, tests) authenticate
 *     via the Bearer header and never carry the cookie.
 *
 * Checking Bearer first lets an API client override an incidental cookie, and
 * dropping either path would break a legitimate client class. Both tokens are
 * verified by the same `verifySessionToken` (issuer/audience/alg pinned), so
 * neither path weakens the signature trust boundary. Documented per L-07; no
 * behavior change.
 */
export async function getSessionFromRequest(
  request: Request,
  secret: string,
): Promise<SessionPayload | null> {
  const token =
    getBearerToken(request) ?? getCookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  return verifySessionToken(secret, token);
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

/**
 * Pentest M-03: when running behind a TLS-terminating reverse proxy
 * (Railway's edge, Cloudflare, etc.), the upstream request URL shows
 * `http://` even when the user's actual connection is HTTPS. Reading
 * `request.url.protocol` alone would drop the `Secure` cookie flag on
 * every production deploy that uses a proxy.
 *
 * Honor `X-Forwarded-Proto` (set by virtually every reverse proxy) so we
 * mark the cookie `Secure` whenever the outermost hop is HTTPS. Fall back
 * to the upstream URL protocol when no header is present (direct calls).
 *
 * In production we additionally force `Secure` regardless — there's no
 * scenario where a production Sonic Bloom deploy should be serving
 * authenticated cookies over plain HTTP.
 */
function shouldUseSecureCookie(request: Request): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  const forwarded = request.headers.get('x-forwarded-proto');
  if (forwarded) {
    // Header may contain a comma-separated chain when multiple proxies are
    // involved (e.g. `https, http`). The OUTERMOST (client-facing) proto
    // is the first entry — that's what tells us about the user's connection.
    const first = forwarded.split(',')[0]?.trim().toLowerCase();
    if (first === 'https') return true;
    if (first === 'http') return false;
  }
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export function buildSessionSetCookie(
  token: string,
  request: Request,
  maxAgeSec: number,
): string {
  const secure = shouldUseSecureCookie(request);
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
  const secure = shouldUseSecureCookie(request);
  const parts = [
    `${SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}
