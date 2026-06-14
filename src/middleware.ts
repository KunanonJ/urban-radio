/**
 * Root Next.js middleware — gates `/api/*` with the same session contract as
 * `functions/api/_middleware.ts`.
 *
 * Cloudflare Access enforcement (the Cf-Access-Jwt-Assertion check) lives at
 * the edge and is bypassed by Railway entirely. For the dual-stack window we
 * only enforce app-session auth here; the Access layer remains active for
 * traffic still hitting the Cloudflare Pages deployment.
 *
 * Public routes (health, login, etc.) are listed in
 * `src/server/auth/require-session.ts:isPublicApiRoute`.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireAppSession } from '@/server/auth/require-session';

export async function middleware(request: NextRequest): Promise<Response> {
  const deny = await requireAppSession(request);
  if (deny) return deny;
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
  // `jose` (HS256 JWT) imports `CompressionStream`/`DecompressionStream`,
  // which the Next Edge Runtime doesn't ship. Pin middleware to Node.js so
  // we can verify session cookies without rewriting auth around web-crypto
  // primitives.
  runtime: 'nodejs',
};
