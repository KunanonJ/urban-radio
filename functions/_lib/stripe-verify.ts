/// <reference types="@cloudflare/workers-types" />

/**
 * Stripe webhook signature verification.
 *
 * Implements Stripe's "Constructing and verifying signatures" protocol:
 *   https://stripe.com/docs/webhooks/signatures#verify-manually
 *
 * Header format:
 *   `Stripe-Signature: t=<unix_ts>,v1=<hex_hmac>[,v1=<hex_hmac>...]`
 *
 * Verification steps:
 *   1. Parse `t=` (UNIX timestamp in seconds) and one-or-more `v1=` entries.
 *   2. Reject if the absolute difference between `t` and "now" exceeds `toleranceSec`
 *      (defaults to 300s; matches Stripe's recommendation).
 *   3. Compute HMAC-SHA256 of the signed-payload string `${t}.${rawBody}` using
 *      the webhook signing secret (`whsec_...`).
 *   4. Constant-time compare the result to each `v1=` value; success on first match.
 *   5. Parse the rawBody as JSON and return the typed event on success.
 *
 * The constant-time compare avoids leaking the secret through response-timing
 * side channels — even though webhooks are usually unauthenticated, we still
 * gate on cryptographic equality.
 *
 * This module is dependency-free: pure WebCrypto + standard library so it runs
 * unchanged in Cloudflare Workers, Node 20+, and Vitest under jsdom.
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

async function computeHmacBytes(secret: string, message: string): Promise<Uint8Array> {
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

export async function verifyStripeSignature(args: VerifyArgs): Promise<VerifyResult> {
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

  // Constant-time scan — visit every v1 entry so timing doesn't leak which one matched.
  let matched = false;
  for (const candidate of parsed.v1) {
    const bytes = hexToBytes(candidate);
    if (!bytes) continue; // malformed hex — skip but keep scanning
    if (constantTimeEqual(bytes, expected)) {
      matched = true;
    }
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
