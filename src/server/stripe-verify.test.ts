/**
 * Unit tests for Stripe webhook signature verification.
 *
 * Covers pentest finding L-10: the v1 candidate scan must not short-circuit
 * in an input-shape-dependent way on malformed hex. Malformed hex is treated
 * as a non-match; it must never throw and never pass.
 *
 * Signatures are generated in-test with the same HMAC-SHA256 construction the
 * production code uses, so no opaque hex constants are hardcoded.
 */

import { describe, expect, it } from 'vitest';

import { verifyStripeSignature } from './stripe-verify';

const SECRET = 'whsec_test_secret_value';
const NOW_SEC = 1_700_000_000;

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Recompute the v1 hex Stripe would send for `${timestamp}.${payload}`. */
async function signPayload(
  secret: string,
  timestamp: number,
  payload: string,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode(`${timestamp}.${payload}`),
  );
  return bytesToHex(new Uint8Array(sig));
}

const VALID_PAYLOAD = JSON.stringify({
  id: 'evt_123',
  type: 'checkout.session.completed',
});

describe('verifyStripeSignature', () => {
  it('given a valid signature within tolerance > then ok with parsed event', async () => {
    const v1 = await signPayload(SECRET, NOW_SEC, VALID_PAYLOAD);
    const signature = `t=${NOW_SEC},v1=${v1}`;

    const result = await verifyStripeSignature({
      payload: VALID_PAYLOAD,
      signature,
      secret: SECRET,
      nowSec: NOW_SEC,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.id).toBe('evt_123');
      expect(result.event.type).toBe('checkout.session.completed');
    }
  });

  it('given a wrong signature > then fails', async () => {
    // A correctly-shaped 32-byte hex that is NOT the real HMAC.
    const wrongHex = '00'.repeat(32);
    const signature = `t=${NOW_SEC},v1=${wrongHex}`;

    const result = await verifyStripeSignature({
      payload: VALID_PAYLOAD,
      signature,
      secret: SECRET,
      nowSec: NOW_SEC,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No valid v1 signature matched');
    }
  });

  it('given a valid signature with drift beyond tolerance > then fails as expired', async () => {
    const oldTimestamp = NOW_SEC - 301; // 1s past the 300s window
    const v1 = await signPayload(SECRET, oldTimestamp, VALID_PAYLOAD);
    const signature = `t=${oldTimestamp},v1=${v1}`;

    const result = await verifyStripeSignature({
      payload: VALID_PAYLOAD,
      signature,
      secret: SECRET,
      nowSec: NOW_SEC,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('outside tolerance');
    }
  });

  it('given a malformed-hex v1 candidate present > then does not throw and does not pass', async () => {
    // Odd-length hex and a non-hex candidate — both malformed. Neither the
    // valid HMAC is present, so verification must fail without throwing.
    const malformedOddLength = 'abc'; // odd length
    const malformedNonHex = 'zz'.repeat(32); // even length, not hex
    const signature = `t=${NOW_SEC},v1=${malformedOddLength},v1=${malformedNonHex}`;

    const result = await verifyStripeSignature({
      payload: VALID_PAYLOAD,
      signature,
      secret: SECRET,
      nowSec: NOW_SEC,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No valid v1 signature matched');
    }
  });

  it('given a malformed-hex candidate before the valid one > then still passes', async () => {
    // A malformed candidate must not block a genuinely valid signature that
    // appears later in the same header. This pins the "accumulate across all
    // candidates" behavior — a malformed entry is a non-match, not a halt.
    const v1 = await signPayload(SECRET, NOW_SEC, VALID_PAYLOAD);
    const malformedNonHex = 'gg'.repeat(32);
    const signature = `t=${NOW_SEC},v1=${malformedNonHex},v1=${v1}`;

    const result = await verifyStripeSignature({
      payload: VALID_PAYLOAD,
      signature,
      secret: SECRET,
      nowSec: NOW_SEC,
    });

    expect(result.ok).toBe(true);
  });

  it('given a malformed-hex candidate AFTER the valid one > then still passes', async () => {
    // The match must be remembered across the rest of the scan: a malformed
    // (or simply non-matching) candidate that follows the valid one must not
    // clobber the accumulated match. Guards against last-candidate-only logic.
    const v1 = await signPayload(SECRET, NOW_SEC, VALID_PAYLOAD);
    const malformedNonHex = 'gg'.repeat(32);
    const signature = `t=${NOW_SEC},v1=${v1},v1=${malformedNonHex}`;

    const result = await verifyStripeSignature({
      payload: VALID_PAYLOAD,
      signature,
      secret: SECRET,
      nowSec: NOW_SEC,
    });

    expect(result.ok).toBe(true);
  });
});
