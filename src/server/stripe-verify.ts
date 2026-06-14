/**
 * Stripe webhook signature verification — Next.js port.
 *
 * Ports `functions/_lib/stripe-verify.ts` byte-for-byte. Implements Stripe's
 * `t=...,v1=...` header format with HMAC-SHA256 over `${t}.${rawBody}` and
 * a constant-time compare against every `v1` candidate. Returns the parsed
 * event on success.
 *
 * Dependency-free: pure WebCrypto + standard library. Runs unchanged under
 * the Next.js Node runtime and vitest's node environment.
 *
 * SECURITY:
 *  - Never logs the secret. The `secret` argument flows only through HMAC.
 *  - Constant-time compare avoids timing side channels.
 *  - Drift rejected at ±300s by default (Stripe's published tolerance).
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

export interface StripeEvent {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
  [key: string]: unknown;
}

export type VerifyResult =
  | { ok: true; event: StripeEvent }
  | { ok: false; error: string };

export interface VerifyArgs {
  payload: string;
  signature: string;
  secret: string;
  /** Seconds. Defaults to 300 (Stripe's recommended tolerance). */
  toleranceSec?: number;
  /** Override for tests; defaults to Date.now() / 1000. */
  nowSec?: number;
}

interface ParsedHeader {
  timestamp: number;
  v1: string[];
}

function safeString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parseHeader(header: string): ParsedHeader | { error: string } {
  if (!header) {
    return { error: 'Missing Stripe-Signature header' };
  }
  let timestamp: number | null = null;
  const v1: string[] = [];

  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k === 't') {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) timestamp = n;
    } else if (k === 'v1') {
      v1.push(v);
    }
  }

  if (timestamp === null) {
    return { error: 'Missing or invalid timestamp (t=) in Stripe-Signature' };
  }
  if (v1.length === 0) {
    return { error: 'No v1 signatures found in Stripe-Signature' };
  }
  return { timestamp, v1 };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = Number.parseInt(hex.substring(i, i + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i / 2] = byte;
  }
  return out;
}

/**
 * Constant-time comparison of two equal-length byte arrays.
 * Returns false immediately for length mismatch (length is not secret).
 */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function computeHmacBytes(
  secret: string,
  message: string,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return new Uint8Array(sig);
}

export async function verifyStripeSignature(
  args: VerifyArgs,
): Promise<VerifyResult> {
  const payload = safeString(args.payload);
  const signature = safeString(args.signature);
  const secret = safeString(args.secret);
  const toleranceSec = args.toleranceSec ?? 300;

  if (!signature) return { ok: false, error: 'Missing signature' };
  if (!secret) return { ok: false, error: 'Missing secret' };
  if (!payload) return { ok: false, error: 'Missing payload' };

  const parsed = parseHeader(signature);
  if ('error' in parsed) {
    return { ok: false, error: parsed.error };
  }

  const nowSec = args.nowSec ?? Math.floor(Date.now() / 1000);
  const drift = Math.abs(nowSec - parsed.timestamp);
  if (drift > toleranceSec) {
    return {
      ok: false,
      error: `Timestamp outside tolerance: drift ${drift}s > ${toleranceSec}s (too old or in the future)`,
    };
  }

  let expected: Uint8Array;
  try {
    expected = await computeHmacBytes(secret, `${parsed.timestamp}.${payload}`);
  } catch (err) {
    return {
      ok: false,
      error: `HMAC computation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Constant-time scan — visit every v1 entry so timing doesn't leak which one
  // matched. Malformed-hex candidates are folded in as a plain non-match rather
  // than `continue`d past, so control flow doesn't branch on input shape
  // (pentest L-10). `hexToBytes` returning null OR the compare failing both
  // contribute `false`; we OR every candidate's result into a single boolean.
  let matched = false;
  for (const candidate of parsed.v1) {
    const bytes = hexToBytes(candidate);
    const isMatch = bytes !== null && constantTimeEqual(bytes, expected);
    matched = matched || isMatch;
  }

  if (!matched) {
    return { ok: false, error: 'No valid v1 signature matched' };
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return { ok: false, error: 'Payload is not valid JSON' };
  }

  return { ok: true, event };
}
