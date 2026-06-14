/// <reference types="@cloudflare/workers-types" />

/** PBKDF2-SHA256, compatible with Node `crypto.pbkdf2Sync` (100k iterations, 32-byte key). */
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;

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

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const enc = new TextEncoder().encode(password);
  const keyMaterial = await crypto.subtle.importKey('raw', enc, { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Verifies password against stored `pbkdf2:<iter>:<saltHex>:<hashHex>` string.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
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
