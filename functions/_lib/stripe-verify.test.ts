import { describe, test, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';

import { verifyStripeSignature } from './stripe-verify';

// In Node test environments lacking globalThis.crypto.subtle, polyfill it.
beforeAll(() => {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    // @ts-expect-error — assign the webcrypto polyfill
    globalThis.crypto = webcrypto;
  }
});

const TEST_SECRET = 'whsec_test_super_secret_value';

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildValidHeader(
  payload: string,
  secret: string,
  tsSec: number,
): Promise<string> {
  const sig = await hmacHex(secret, `${tsSec}.${payload}`);
  return `t=${tsSec},v1=${sig}`;
}

describe('verifyStripeSignature', () => {
  test('given a valid signature with current timestamp > returns ok:true with parsed event', async () => {
    const payload = JSON.stringify({ id: 'evt_123', type: 'checkout.session.completed' });
    const tsSec = Math.floor(Date.now() / 1000);
    const header = await buildValidHeader(payload, TEST_SECRET, tsSec);
    const result = await verifyStripeSignature({
      payload,
      signature: header,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.id).toBe('evt_123');
      expect(result.event.type).toBe('checkout.session.completed');
    }
  });

  test('given a tampered payload > returns ok:false', async () => {
    const original = JSON.stringify({ id: 'evt_123', type: 'checkout.session.completed' });
    const tsSec = Math.floor(Date.now() / 1000);
    const header = await buildValidHeader(original, TEST_SECRET, tsSec);
    const tampered = original.replace('evt_123', 'evt_HACKED');
    const result = await verifyStripeSignature({
      payload: tampered,
      signature: header,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/signature/i);
    }
  });

  test('given an old timestamp beyond default tolerance (5min) > returns ok:false', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    // 10 minutes ago — beyond default 300s tolerance.
    const tsSec = Math.floor(Date.now() / 1000) - 600;
    const header = await buildValidHeader(payload, TEST_SECRET, tsSec);
    const result = await verifyStripeSignature({
      payload,
      signature: header,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/timestamp|tolerance|old/i);
    }
  });

  test('given an old timestamp WITH a wide custom tolerance > returns ok:true', async () => {
    const payload = JSON.stringify({ id: 'evt_2', type: 'invoice.paid' });
    const tsSec = Math.floor(Date.now() / 1000) - 600;
    const header = await buildValidHeader(payload, TEST_SECRET, tsSec);
    const result = await verifyStripeSignature({
      payload,
      signature: header,
      secret: TEST_SECRET,
      toleranceSec: 3600,
    });
    expect(result.ok).toBe(true);
  });

  test('given a header without v1= > returns ok:false', async () => {
    const tsSec = Math.floor(Date.now() / 1000);
    const result = await verifyStripeSignature({
      payload: '{}',
      signature: `t=${tsSec},v0=deadbeef`,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/v1|signature/i);
    }
  });

  test('given a header without t= > returns ok:false', async () => {
    const result = await verifyStripeSignature({
      payload: '{}',
      signature: 'v1=deadbeef',
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/timestamp/i);
    }
  });

  test('given null signature > returns ok:false safely (no throw)', async () => {
    const result = await verifyStripeSignature({
      payload: '{}',
      signature: null as unknown as string,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
  });

  test('given empty secret > returns ok:false safely', async () => {
    const result = await verifyStripeSignature({
      payload: '{}',
      signature: 't=1,v1=abc',
      secret: '',
    });
    expect(result.ok).toBe(false);
  });

  test('accepts multiple v1 signatures (key rotation case) — any matching one passes', async () => {
    const payload = JSON.stringify({ id: 'evt_3', type: 'customer.subscription.updated' });
    const tsSec = Math.floor(Date.now() / 1000);
    const validSig = await hmacHex(TEST_SECRET, `${tsSec}.${payload}`);
    const header = `t=${tsSec},v1=deadbeef00000000,v1=${validSig}`;
    const result = await verifyStripeSignature({
      payload,
      signature: header,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(true);
  });

  test('returns ok:false when none of the v1 signatures match (constant-time scan)', async () => {
    const payload = JSON.stringify({ id: 'evt_x', type: 'invoice.paid' });
    const tsSec = Math.floor(Date.now() / 1000);
    const header = `t=${tsSec},v1=deadbeef00000000,v1=cafebabe11111111`;
    const result = await verifyStripeSignature({
      payload,
      signature: header,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
  });

  test('returns ok:false when payload is not valid JSON (still verifies signature first)', async () => {
    const payload = 'not json';
    const tsSec = Math.floor(Date.now() / 1000);
    const header = await buildValidHeader(payload, TEST_SECRET, tsSec);
    const result = await verifyStripeSignature({
      payload,
      signature: header,
      secret: TEST_SECRET,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/json|parse/i);
    }
  });
});
