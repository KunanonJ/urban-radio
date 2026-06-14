/**
 * PBKDF2-SHA256 password verification.
 *
 * Mirrors `functions/_lib/password.ts` byte-for-byte so hashes written by the
 * Cloudflare runtime verify identically under Node. Stored format is
 *
 *   pbkdf2:<iterations>:<saltHex>:<hashHex>
 *
 * Verification uses Web Crypto (`crypto.subtle.deriveBits`), which is
 * available globally on Node 16+ and in all browser/edge runtimes — so this
 * file is identical to the legacy one except for the missing
 * Workers-types reference. Don't introduce divergence here without a paired
 * change on the Cloudflare side; cross-stack hash mismatch is a silent auth
 * outage waiting to happen.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

const KEY_LENGTH = 32;

/**
 * OWASP 2023+ recommends PBKDF2-SHA256 at 600,000 iterations as the floor
 * for password hashes. Pentest M-01 raised our default from 100,000 to this
 * value for newly minted hashes. Existing hashes continue to verify because
 * the iteration count is encoded per-row in the stored string.
 */
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

const SALT_LENGTH = 16;

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length / 2;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(password);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash `plain` for storage in the `auth_users.password_hash` column.
 *
 * Returns a string in the `pbkdf2:<iter>:<saltHex>:<hashHex>` format that
 * `verifyPassword` accepts. Uses `DEFAULT_PBKDF2_ITERATIONS` (600,000) per
 * pentest M-01 / OWASP 2023.
 *
 * Salt is 16 random bytes from `crypto.getRandomValues` — distinct per
 * call.
 */
export async function hashPassword(
  plain: string,
  opts: { iterations?: number } = {},
): Promise<string> {
  const iterations = opts.iterations ?? DEFAULT_PBKDF2_ITERATIONS;
  const salt = new Uint8Array(SALT_LENGTH);
  crypto.getRandomValues(salt);
  const derived = await deriveKey(plain, salt, iterations);
  return `pbkdf2:${iterations}:${bytesToHex(salt)}:${bytesToHex(derived)}`;
}

/**
 * Verifies `plain` against a stored `pbkdf2:<iter>:<saltHex>:<hashHex>`
 * string. Returns `false` for any malformed input rather than throwing.
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iter = parseInt(parts[1], 10);
  if (!Number.isFinite(iter) || iter < 1) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = hexToBytes(parts[2]);
    expected = hexToBytes(parts[3]);
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;
  const derived = await deriveKey(plain, salt, iter);
  return timingSafeEqual(derived, expected);
}
