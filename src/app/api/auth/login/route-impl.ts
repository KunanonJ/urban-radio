/**
 * POST /api/auth/login — username/password → session cookie.
 *
 * Mirrors `functions/api/auth/login.ts`. Same JWT contract (`sb_session`,
 * HS256, 7d), same `pbkdf2:<iter>:<saltHex>:<hashHex>` password format —
 * sessions minted here are accepted by both stacks and vice-versa during
 * the dual-stack window.
 *
 * Public per `requireAppSession.isPublicApiRoute`.
 */

import { eq, sql } from 'drizzle-orm';

import { getDb, type DbClient } from '@/db/client';
import { authUsers } from '@/db/schema';
import { jsonError, jsonOk } from '@/server/api-response';
import {
  DEFAULT_PBKDF2_ITERATIONS,
  hashPassword,
  verifyPassword,
} from '@/server/auth/password';
import {
  SESSION_TTL_SECONDS,
  buildSessionSetCookie,
  signSessionToken,
} from '@/server/auth/session-jwt';
import {
  defaultRateLimiter,
  extractIp,
  LOGIN_LIMIT,
  LOGIN_IP_LIMIT,
  rateLimitedResponse,
  type RateLimiter,
} from '@/server/rate-limit';

interface LoginDeps {
  db?: DbClient;
  secret?: string;
  /** Injected in tests to control rate-limit state independently. */
  rateLimiter?: RateLimiter;
}

/**
 * Pentest H-01: username timing oracle. The original `!row || !verify(...)`
 * short-circuit returned in ~1 ms for unknown users (PBKDF2 never ran) vs
 * ~100–300 ms for known users. Response latency directly leaked whether
 * the username existed.
 *
 * Fix: when the user is not found, still run `verifyPassword` against a
 * fixed dummy hash so the CPU cost — and therefore the response time —
 * looks identical to a real password mismatch.
 *
 * The dummy hash is computed once at module load (top-level await is fine
 * in a Node route handler bundle), at the same iteration count as freshly
 * minted real hashes.
 */
const DUMMY_PASSWORD_HASH = await hashPassword(
  'sonic-bloom-dummy-password-' + Math.random().toString(36),
  { iterations: DEFAULT_PBKDF2_ITERATIONS },
);

export async function postLogin(
  request: Request,
  deps: LoginDeps = {},
): Promise<Response> {
  const secret = (deps.secret ?? process.env.AUTH_JWT_SECRET ?? '').trim();
  if (!secret) {
    return jsonError(503, 'AUTH_JWT_SECRET is not configured');
  }

  let body: { username?: string; password?: string };
  try {
    body = (await request.json()) as { username?: string; password?: string };
  } catch {
    return jsonError(400, 'Invalid JSON');
  }

  // Pentest L-09: normalize the submitted username to NFKC before trimming and
  // the DB lookup. The SQL compare is `lower(username) = lower($1)`, but
  // `lower()` does not collapse Unicode compatibility/full-width forms — so
  // "ａｄｍｉｎ" (full-width) would NOT match a stored "admin" without this. NFKC
  // folds those equivalents onto their canonical form, closing the
  // normalization collision class. Seeded usernames are normalized identically
  // (scripts/seed-railway-admin.mjs) so stored and compared values stay
  // consistent. For ASCII usernames like "admin", NFKC is a no-op.
  const username =
    typeof body.username === 'string'
      ? body.username.normalize('NFKC').trim()
      : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) {
    return jsonError(400, 'Username and password are required');
  }

  // Pentest H-02: rate limit before any DB or crypto work.
  // Check per-username first (tightest limit), then per-IP (stuffing defense).
  const limiter = deps.rateLimiter ?? defaultRateLimiter;
  const userKey = `login:user:${username.toLowerCase()}`;
  const ipKey = `login:ip:${extractIp(request)}`;

  const userCheck = limiter.consume(userKey, LOGIN_LIMIT);
  if (!userCheck.allowed) {
    return rateLimitedResponse(userCheck.retryAfterSec);
  }

  const ipCheck = limiter.consume(ipKey, LOGIN_IP_LIMIT);
  if (!ipCheck.allowed) {
    return rateLimitedResponse(ipCheck.retryAfterSec);
  }

  let row: { id: string; passwordHash: string } | undefined;
  try {
    const db = deps.db ?? getDb();
    // Postgres collation default isn't NOCASE; we do an explicit lower() compare
    // to preserve the legacy case-insensitive matching from D1's COLLATE NOCASE.
    const rows = await db
      .select({ id: authUsers.id, passwordHash: authUsers.passwordHash })
      .from(authUsers)
      .where(sql`lower(${authUsers.username}) = lower(${username})`)
      .limit(1);
    row = rows[0];
  } catch {
    return jsonError(503, 'Database unavailable');
  }

  // Pentest H-01: kill the timing oracle. Always invoke `verifyPassword`,
  // even when the username doesn't exist — pass the dummy hash so PBKDF2
  // runs with the same cost. The discard-the-result pattern below keeps
  // the control flow uniform from the attacker's wall-clock perspective.
  if (!row) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return jsonError(401, 'Invalid username or password');
  }
  if (!(await verifyPassword(password, row.passwordHash))) {
    return jsonError(401, 'Invalid username or password');
  }

  const token = await signSessionToken(secret, { sub: row.id, username });
  // Pentest M-04: cookie Max-Age matches JWT exp so the cookie doesn't
  // outlive the underlying credential (8h shift).
  const cookie = buildSessionSetCookie(token, request, SESSION_TTL_SECONDS);

  return jsonOk(
    { ok: true, user: { username } },
    {
      headers: { 'Set-Cookie': cookie },
    },
  );
}

// Silence the unused eq import; it's kept for parity with future updates.
void eq;

export async function POST(request: Request): Promise<Response> {
  return postLogin(request);
}
