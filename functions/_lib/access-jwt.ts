/// <reference types="@cloudflare/workers-types" />

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { SonicBloomEnv } from './env';

const JWKS_CACHE = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  const normalized = teamDomain.replace(/\/$/, '');
  let jwks = JWKS_CACHE.get(normalized);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${normalized}/cdn-cgi/access/certs`));
    JWKS_CACHE.set(normalized, jwks);
  }
  return jwks;
}

/**
 * Verifies `Cf-Access-Jwt-Assertion` per Cloudflare docs.
 * @see https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 */
export async function verifyCfAccessJwt(
  token: string,
  teamDomain: string,
  policyAud: string,
): Promise<void> {
  const normalized = teamDomain.replace(/\/$/, '');
  const JWKS = getJwks(normalized);
  await jwtVerify(token, JWKS, {
    issuer: normalized,
    audience: policyAud,
  });
}

export function accessJwtEnforced(env: SonicBloomEnv): boolean {
  const team = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_POLICY_AUD?.trim();
  return Boolean(team && aud);
}

export async function requireCfAccessJwt(
  request: Request,
  env: SonicBloomEnv,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  if (!accessJwtEnforced(env)) {
    return { ok: true };
  }
  const team = env.ACCESS_TEAM_DOMAIN!.trim().replace(/\/$/, '');
  const aud = env.ACCESS_POLICY_AUD!.trim();

  const token =
    request.headers.get('cf-access-jwt-assertion') ??
    request.headers.get('CF-Access-Jwt-Assertion');
  if (!token) {
    return { ok: false, status: 401, body: 'Missing Cf-Access-Jwt-Assertion' };
  }
  try {
    await verifyCfAccessJwt(token, team, aud);
    return { ok: true };
  } catch {
    return { ok: false, status: 403, body: 'Invalid Cloudflare Access token' };
  }
}
