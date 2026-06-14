import { describe, test, expect, vi, beforeAll, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';

import { onRequestPost } from './stripe';
import type { SonicBloomEnv } from '../../_lib/env';

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

interface PreparedStmt {
  sql: string;
  binds: unknown[];
}

const buildDb = (opts: { runThrows?: boolean } = {}) => {
  const prepared: PreparedStmt[] = [];
  const runFn = vi.fn(() => {
    if (opts.runThrows) throw new Error('db down');
    return Promise.resolve({ success: true });
  });
  const prepare = vi.fn((sql: string) => {
    const stmt: PreparedStmt = { sql, binds: [] };
    prepared.push(stmt);
    return {
      bind: (...args: unknown[]) => {
        stmt.binds.push(...args);
        return { run: runFn };
      },
    };
  });
  return { prepare, runFn, prepared };
};

async function buildSignedRequest(
  payload: string,
  secret: string,
  tsSec: number = Math.floor(Date.now() / 1000),
): Promise<Request> {
  const sig = await hmacHex(secret, `${tsSec}.${payload}`);
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'Stripe-Signature': `t=${tsSec},v1=${sig}`, 'Content-Type': 'application/json' },
    body: payload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/webhooks/stripe', () => {
  test('given STRIPE_WEBHOOK_SECRET unset > returns 503 stripe_not_configured', async () => {
    const db = buildDb();
    const env = { DB: db as unknown as D1Database } as SonicBloomEnv;
    const req = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'Stripe-Signature': 't=1,v1=ff', 'Content-Type': 'application/json' },
      body: '{}',
    });
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('stripe_not_configured');
    expect(db.prepare).not.toHaveBeenCalled();
  });

  test('given missing Stripe-Signature header > returns 400', async () => {
    const env = {
      DB: buildDb() as unknown as D1Database,
      STRIPE_WEBHOOK_SECRET: TEST_SECRET,
    } as unknown as SonicBloomEnv;
    const req = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(400);
  });

  test('given a tampered signature > returns 400 invalid_signature', async () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });
    const tsSec = Math.floor(Date.now() / 1000);
    const req = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Stripe-Signature': `t=${tsSec},v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
        'Content-Type': 'application/json',
      },
      body: payload,
    });
    const db = buildDb();
    const env = {
      DB: db as unknown as D1Database,
      STRIPE_WEBHOOK_SECRET: TEST_SECRET,
    } as unknown as SonicBloomEnv;
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_signature');
    expect(db.prepare).not.toHaveBeenCalled();
  });

  test('given a valid checkout.session.completed > returns 200 and writes audit_log', async () => {
    const payload = JSON.stringify({ id: 'evt_chk', type: 'checkout.session.completed' });
    const req = await buildSignedRequest(payload, TEST_SECRET);
    const db = buildDb();
    const env = {
      DB: db as unknown as D1Database,
      STRIPE_WEBHOOK_SECRET: TEST_SECRET,
    } as unknown as SonicBloomEnv;
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; type: string };
    expect(body.received).toBe(true);
    expect(body.type).toBe('checkout.session.completed');
    const auditStmt = db.prepared.find((s) => /INSERT INTO audit_log/i.test(s.sql));
    expect(auditStmt).toBeDefined();
    // action column: 'stripe_checkout.session.completed'
    expect(auditStmt!.binds).toContain('stripe_checkout.session.completed');
  });

  test('given each known event type > writes audit_log row', async () => {
    const knownEvents = [
      'checkout.session.completed',
      'invoice.paid',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ];
    for (const type of knownEvents) {
      const payload = JSON.stringify({ id: `evt_${type}`, type });
      const req = await buildSignedRequest(payload, TEST_SECRET);
      const db = buildDb();
      const env = {
        DB: db as unknown as D1Database,
        STRIPE_WEBHOOK_SECRET: TEST_SECRET,
      } as unknown as SonicBloomEnv;
      const res = await onRequestPost({ env, request: req });
      expect(res.status).toBe(200);
      const auditStmt = db.prepared.find((s) => /INSERT INTO audit_log/i.test(s.sql));
      expect(auditStmt, `expected audit row for ${type}`).toBeDefined();
      expect(auditStmt!.binds).toContain(`stripe_${type}`);
    }
  });

  test('given an unknown event type > returns 200 OK without audit_log row', async () => {
    const payload = JSON.stringify({ id: 'evt_x', type: 'random.unknown.event' });
    const req = await buildSignedRequest(payload, TEST_SECRET);
    const db = buildDb();
    const env = {
      DB: db as unknown as D1Database,
      STRIPE_WEBHOOK_SECRET: TEST_SECRET,
    } as unknown as SonicBloomEnv;
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(200);
    const auditStmt = db.prepared.find((s) => /INSERT INTO audit_log/i.test(s.sql));
    expect(auditStmt).toBeUndefined();
  });

  test('given audit_log write throws > still returns 200 (best-effort)', async () => {
    const payload = JSON.stringify({ id: 'evt_chk2', type: 'invoice.paid' });
    const req = await buildSignedRequest(payload, TEST_SECRET);
    const db = buildDb({ runThrows: true });
    const env = {
      DB: db as unknown as D1Database,
      STRIPE_WEBHOOK_SECRET: TEST_SECRET,
    } as unknown as SonicBloomEnv;
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(200);
  });

  test('given no DB binding > still returns 200 for valid event (no audit op possible)', async () => {
    const payload = JSON.stringify({ id: 'evt_chk3', type: 'invoice.paid' });
    const req = await buildSignedRequest(payload, TEST_SECRET);
    const env = { STRIPE_WEBHOOK_SECRET: TEST_SECRET } as unknown as SonicBloomEnv;
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(200);
  });

  test('given an old timestamp (>5min) > returns 400 invalid_signature', async () => {
    const payload = JSON.stringify({ id: 'evt_old', type: 'invoice.paid' });
    const tsSec = Math.floor(Date.now() / 1000) - 600;
    const req = await buildSignedRequest(payload, TEST_SECRET, tsSec);
    const db = buildDb();
    const env = {
      DB: db as unknown as D1Database,
      STRIPE_WEBHOOK_SECRET: TEST_SECRET,
    } as unknown as SonicBloomEnv;
    const res = await onRequestPost({ env, request: req });
    expect(res.status).toBe(400);
  });
});
