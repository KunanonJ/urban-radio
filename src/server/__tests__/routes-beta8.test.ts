// @vitest-environment node
// Route handlers use `jose` (HS256) and WebCrypto HMAC; both require a real
// node runtime, hence the directive above.

/**
 * Wave RM-β8 — Royalty + Stations + Webhooks Next.js Route Handlers.
 *
 * Each test exercises the named handler against a pg-mem-backed Drizzle
 * client. We assert on the byte-identical response shape the Cloudflare
 * counterpart emits (CSV column order for royalty, JSON envelope for
 * stations/me, signature pass/fail for Stripe).
 *
 * The pg-mem harness handles foreign-key cascade between `audit_log` and
 * `stations`, so audit writes that target an existing stationId succeed,
 * while the Stripe handler's `stationId: 'unknown'` case silently fails the
 * FK and is swallowed by `writeAuditLog` — both behaviors match the
 * Cloudflare contract.
 */

import { describe, expect, test } from 'vitest';

import { getRoyaltyExport } from '@/app/api/royalty/export/route-impl';
import {
  getStationsMe,
  patchStationsMe,
} from '@/app/api/stations/me/route-impl';
import { postStripeWebhook } from '@/app/api/webhooks/stripe/route-impl';
import {
  sessionCookieName,
  signSessionToken,
} from '@/server/auth/session-jwt';
import {
  createTestDb,
  createTestDbWithUser,
} from '@/server/test-utils/db';

const SECRET = 'beta8-test-secret';
const STRIPE_SECRET = 'whsec_test_beta8_super_secret_value';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildAuthedRequest(
  url: string,
  init: RequestInit & { sub?: string; username?: string } = {},
): Promise<Request> {
  const sub = init.sub ?? 'user-test';
  const username = init.username ?? 'tester';
  const token = await signSessionToken(SECRET, { sub, username });
  const headers = new Headers(init.headers);
  headers.set(
    'Cookie',
    `${sessionCookieName()}=${encodeURIComponent(token)}`,
  );
  return new Request(url, { ...init, headers });
}

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

async function buildSignedStripeRequest(
  payload: string,
  secret: string,
  tsSec: number = Math.floor(Date.now() / 1000),
): Promise<Request> {
  const sig = await hmacHex(secret, `${tsSec}.${payload}`);
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: {
      'Stripe-Signature': `t=${tsSec},v1=${sig}`,
      'Content-Type': 'application/json',
    },
    body: payload,
  });
}

// ===========================================================================
// /api/royalty/export
// ===========================================================================

describe('GET /api/royalty/export', () => {
  const VALID_QS =
    '?format=ascap&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z';

  test('401 when AUTH_JWT_SECRET is unset', async () => {
    const { handle } = createTestDbWithUser();
    const req = new Request(
      `http://localhost/api/royalty/export${VALID_QS}`,
    );
    const res = await getRoyaltyExport(req, { db: handle.db, secret: '' });
    expect(res.status).toBe(401);
  });

  test('401 when session cookie is absent', async () => {
    const { handle } = createTestDbWithUser();
    const req = new Request(
      `http://localhost/api/royalty/export${VALID_QS}`,
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(401);
  });

  test('403 when user has no station membership', async () => {
    // Fresh DB, but seed only the auth user — no station_members row.
    const { db, mem } = createTestDb();
    mem.public.none(
      "INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('orphan', 'orphan', 'pbkdf2:1:00:00', '2026-01-01T00:00:00Z')",
    );
    const req = await buildAuthedRequest(
      `http://localhost/api/royalty/export${VALID_QS}`,
      { sub: 'orphan', username: 'orphan' },
    );
    const res = await getRoyaltyExport(req, { db, secret: SECRET });
    expect(res.status).toBe(403);
  });

  test('pentest M-12: 403 when role is operator (not admin/programmer)', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'operator' });
    const req = await buildAuthedRequest(
      `http://localhost/api/royalty/export${VALID_QS}`,
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/insufficient role/i);
  });

  test('pentest M-12: 403 when role is producer (not admin/programmer)', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'producer' });
    const req = await buildAuthedRequest(
      `http://localhost/api/royalty/export${VALID_QS}`,
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('pentest M-12: admin role can export (regression check)', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    const req = await buildAuthedRequest(
      `http://localhost/api/royalty/export${VALID_QS}`,
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    // 200 if a valid CSV body comes back (the existing tests cover this).
    expect(res.status).toBe(200);
  });

  test('pentest M-12: programmer role can export', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'programmer' });
    const req = await buildAuthedRequest(
      `http://localhost/api/royalty/export${VALID_QS}`,
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
  });

  test('400 on invalid format', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await buildAuthedRequest(
      `http://localhost/api/royalty/export?format=socan&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z`,
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('400 on non-ISO from/to', async () => {
    const { handle, user } = createTestDbWithUser();
    const req = await buildAuthedRequest(
      `http://localhost/api/royalty/export?format=ascap&from=not-a-date&to=also-not`,
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('200 ASCAP CSV with header + row matches Cloudflare column order', async () => {
    const { handle, user } = createTestDbWithUser({
      stationId: 'urban-radio',
    });
    // Update station name so the SoundExchange test below sees 'Urban Radio'.
    handle.mem.public.none(
      "UPDATE stations SET name = 'Urban Radio' WHERE id = 'urban-radio'",
    );
    // Seed a single play_log row inside the window.
    handle.mem.public.none(
      `INSERT INTO play_log (id, station_id, track_id, title_snapshot, artist_snapshot, played_at, duration_played_ms, source, isrc, iswc)
       VALUES ('p1', 'urban-radio', 't1', 'Song A', 'Artist A', '2026-05-13T10:00:00Z', 180000, 'automation', 'USRC17607839', 'T-034.524.680-1')`,
    );

    const req = await buildAuthedRequest(
      `http://localhost/api/royalty/export${VALID_QS}`,
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/^text\/csv/);
    expect(res.headers.get('X-Row-Count')).toBe('1');
    expect(res.headers.get('Content-Disposition')).toContain(
      'attachment;',
    );
    expect(res.headers.get('Content-Disposition')).toContain('urban-radio-ascap');

    // Read raw bytes so we can verify the leading UTF-8 BOM (EF BB BF) is on
    // the wire — Response.text() strips it during decoding.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
    const body = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '');
    // Column order MUST match the Cloudflare emitter.
    expect(body).toContain(
      'TitleOfWork,WriterPerformer,ISWC,ISRC,Date,TimePlayed,DurationSeconds,Source',
    );
    expect(body).toContain(
      'Song A,Artist A,T-034.524.680-1,USRC17607839,2026-05-13,10:00:00,180,automation',
    );
  });

  test('200 BMI CSV with BMI-specific column header order', async () => {
    const { handle, user } = createTestDbWithUser({
      stationId: 'urban-radio',
    });
    handle.mem.public.none(
      `INSERT INTO play_log (id, station_id, track_id, title_snapshot, artist_snapshot, played_at, duration_played_ms, source, isrc, iswc)
       VALUES ('p1', 'urban-radio', 't1', 'Song A', 'Artist A', '2026-05-13T10:00:00Z', 180000, 'automation', 'USRC17607839', 'T-034.524.680-1')`,
    );

    const req = await buildAuthedRequest(
      'http://localhost/api/royalty/export?format=bmi&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z',
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      'SongTitle,Artist,ISRC,ISWC,PlayDate,PlayTime,DurationSeconds,FeatureType',
    );
  });

  test('200 SoundExchange CSV with DPR header + station name in NameOfService', async () => {
    const { handle, user } = createTestDbWithUser({
      stationId: 'urban-radio',
    });
    handle.mem.public.none(
      "UPDATE stations SET name = 'Urban Radio' WHERE id = 'urban-radio'",
    );
    handle.mem.public.none(
      `INSERT INTO play_log (id, station_id, track_id, title_snapshot, artist_snapshot, played_at, duration_played_ms, source, isrc, iswc)
       VALUES ('p1', 'urban-radio', 't1', 'Song A', 'Artist A', '2026-05-13T10:00:00Z', 180000, 'automation', 'USRC17607839', 'T-034.524.680-1')`,
    );

    const req = await buildAuthedRequest(
      'http://localhost/api/royalty/export?format=soundexchange&from=2026-05-01T00:00:00Z&to=2026-06-01T00:00:00Z',
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      'NameOfService,TransmissionCategory,FeaturedArtist,SoundRecordingTitle,ISRC,Album,MarketingLabel,ActualTotalPerformances',
    );
    expect(body).toContain('Urban Radio,Webcasting,Artist A,Song A');
  });

  test('audit_log row written with action=royalty_export', async () => {
    const { handle, user } = createTestDbWithUser({
      stationId: 'urban-radio',
    });
    handle.mem.public.none(
      `INSERT INTO play_log (id, station_id, title_snapshot, played_at, source)
       VALUES ('p1', 'urban-radio', 'Song A', '2026-05-13T10:00:00Z', 'automation')`,
    );

    const req = await buildAuthedRequest(
      `http://localhost/api/royalty/export${VALID_QS}`,
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);

    const auditRows = handle.mem.public.many(
      "SELECT action, target_type, target_id, actor_user_id, station_id, after_json FROM audit_log WHERE action = 'royalty_export'",
    ) as Array<{
      action: string;
      target_type: string;
      target_id: string;
      actor_user_id: string;
      station_id: string;
      after_json: string | null;
    }>;
    expect(auditRows).toHaveLength(1);
    const row = auditRows[0];
    expect(row.target_type).toBe('station');
    expect(row.target_id).toBe('urban-radio');
    expect(row.actor_user_id).toBe(user.userId);
    expect(row.station_id).toBe('urban-radio');
    const after = JSON.parse(row.after_json ?? '{}') as Record<string, unknown>;
    expect(after.format).toBe('ascap');
    expect(after.rowCount).toBe(1);
  });

  test('play_log SELECT is scoped to caller stationId — no cross-station leak', async () => {
    const { handle, user } = createTestDbWithUser({
      stationId: 'station-a',
    });
    // Seed a second station + a play_log row on that station.
    handle.mem.public.none(
      "INSERT INTO stations (id, org_id, slug, name, timezone, created_at) VALUES ('station-b', '" +
        user.orgId +
        "', 'b', 'B', 'UTC', '2026-01-01T00:00:00Z')",
    );
    handle.mem.public.none(
      `INSERT INTO play_log (id, station_id, title_snapshot, played_at, source)
       VALUES ('p-foreign', 'station-b', 'Foreign', '2026-05-13T10:00:00Z', 'automation')`,
    );

    const req = await buildAuthedRequest(
      `http://localhost/api/royalty/export${VALID_QS}`,
      { sub: user.userId, username: user.username },
    );
    const res = await getRoyaltyExport(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Row-Count')).toBe('0');
    const body = await res.text();
    expect(body).not.toContain('Foreign');
  });
});

// ===========================================================================
// /api/stations/me
// ===========================================================================

describe('GET /api/stations/me', () => {
  test('401 when no session cookie', async () => {
    const { handle } = createTestDbWithUser();
    const req = new Request('http://localhost/api/stations/me');
    const res = await getStationsMe(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(401);
  });

  test('403 when session valid but user has no station membership', async () => {
    const { db, mem } = createTestDb();
    mem.public.none(
      "INSERT INTO auth_users (id, username, password_hash, created_at) VALUES ('orphan', 'orphan', 'pbkdf2:1:00:00', '2026-01-01T00:00:00Z')",
    );
    const req = await buildAuthedRequest(
      'http://localhost/api/stations/me',
      { sub: 'orphan', username: 'orphan' },
    );
    const res = await getStationsMe(req, { db, secret: SECRET });
    expect(res.status).toBe(403);
  });

  test('200 returns { station, member, currentUser } envelope', async () => {
    const { handle, user } = createTestDbWithUser({
      stationId: 'urban-radio',
      orgId: 'org-1',
      role: 'admin',
    });
    // Rename the seeded station so the response carries known fields.
    handle.mem.public.none(
      "UPDATE stations SET name = 'Urban Radio', slug = 'urban-radio', timezone = 'Asia/Bangkok', language = 'en', stream_url = 'https://stream.example.com/live' WHERE id = 'urban-radio'",
    );

    const req = await buildAuthedRequest(
      'http://localhost/api/stations/me',
      { sub: user.userId, username: user.username },
    );
    const res = await getStationsMe(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      station: Record<string, unknown>;
      member: { stationId: string; userId: string; role: string };
      currentUser: { id: string; username: string };
    };

    // Cloudflare parity on the `station` field.
    expect(body.station).toEqual({
      id: 'urban-radio',
      orgId: 'org-1',
      slug: 'urban-radio',
      name: 'Urban Radio',
      timezone: 'Asia/Bangkok',
      streamUrl: 'https://stream.example.com/live',
      language: 'en',
      createdAt: '2026-01-01T00:00:00Z',
    });

    // Next-side additions.
    expect(body.member).toEqual({
      stationId: 'urban-radio',
      userId: user.userId,
      role: 'admin',
    });
    expect(body.currentUser).toEqual({
      id: user.userId,
      username: user.username,
    });
  });
});

describe('PATCH /api/stations/me', () => {
  test('403 when role is guest_vt (not admin/producer)', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'guest_vt' });
    const req = await buildAuthedRequest(
      'http://localhost/api/stations/me',
      {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New Name' }),
        headers: { 'Content-Type': 'application/json' },
        sub: user.userId,
        username: user.username,
      },
    );
    const res = await patchStationsMe(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('403 when role is operator (only admin/producer can edit identity)', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'operator' });
    const req = await buildAuthedRequest(
      'http://localhost/api/stations/me',
      {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New Name' }),
        headers: { 'Content-Type': 'application/json' },
        sub: user.userId,
        username: user.username,
      },
    );
    const res = await patchStationsMe(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(403);
  });

  test('400 on invalid JSON', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    const req = await buildAuthedRequest(
      'http://localhost/api/stations/me',
      {
        method: 'PATCH',
        body: 'not json',
        headers: { 'Content-Type': 'application/json' },
        sub: user.userId,
        username: user.username,
      },
    );
    const res = await patchStationsMe(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('400 on empty patch {}', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    const req = await buildAuthedRequest(
      'http://localhost/api/stations/me',
      {
        method: 'PATCH',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
        sub: user.userId,
        username: user.username,
      },
    );
    const res = await patchStationsMe(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('400 on invalid timezone', async () => {
    const { handle, user } = createTestDbWithUser({ role: 'admin' });
    const req = await buildAuthedRequest(
      'http://localhost/api/stations/me',
      {
        method: 'PATCH',
        body: JSON.stringify({ timezone: 'Mordor/Barad-dur' }),
        headers: { 'Content-Type': 'application/json' },
        sub: user.userId,
        username: user.username,
      },
    );
    const res = await patchStationsMe(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(400);
  });

  test('200 + UPDATE + audit_log row when admin sends valid patch', async () => {
    const { handle, user } = createTestDbWithUser({
      stationId: 'urban-radio',
      role: 'admin',
    });
    handle.mem.public.none(
      "UPDATE stations SET name = 'Urban Radio' WHERE id = 'urban-radio'",
    );

    const req = await buildAuthedRequest(
      'http://localhost/api/stations/me',
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Urban Radio v2',
          timezone: 'America/New_York',
        }),
        headers: { 'Content-Type': 'application/json' },
        sub: user.userId,
        username: user.username,
      },
    );
    const res = await patchStationsMe(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      station: { name: string; timezone: string };
    };
    expect(body.station.name).toBe('Urban Radio v2');
    expect(body.station.timezone).toBe('America/New_York');

    // Direct DB read for parity with the Cloudflare test's INSERT-binding check.
    const auditRows = handle.mem.public.many(
      "SELECT action, target_type, target_id, actor_user_id, station_id FROM audit_log WHERE action = 'update'",
    ) as Array<{
      action: string;
      target_type: string;
      target_id: string;
      actor_user_id: string;
      station_id: string;
    }>;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].target_type).toBe('station');
    expect(auditRows[0].station_id).toBe('urban-radio');
    expect(auditRows[0].actor_user_id).toBe(user.userId);
  });

  test('producer can clear stream_url with streamUrl: null', async () => {
    const { handle, user } = createTestDbWithUser({
      stationId: 'urban-radio',
      role: 'producer',
    });
    handle.mem.public.none(
      "UPDATE stations SET stream_url = 'https://stream.example.com/live' WHERE id = 'urban-radio'",
    );

    const req = await buildAuthedRequest(
      'http://localhost/api/stations/me',
      {
        method: 'PATCH',
        body: JSON.stringify({ streamUrl: null }),
        headers: { 'Content-Type': 'application/json' },
        sub: user.userId,
        username: user.username,
      },
    );
    const res = await patchStationsMe(req, {
      db: handle.db,
      secret: SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      station: { streamUrl: string | null };
    };
    expect(body.station.streamUrl).toBeNull();
  });
});

// ===========================================================================
// /api/webhooks/stripe
// ===========================================================================

describe('POST /api/webhooks/stripe', () => {
  test('503 stripe_not_configured when secret is unset', async () => {
    const { handle } = createTestDbWithUser();
    const req = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'Stripe-Signature': 't=1,v1=ff' },
      body: '{}',
    });
    const res = await postStripeWebhook(req, {
      db: handle.db,
      secret: '',
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('stripe_not_configured');
  });

  test('400 missing_signature_header when header is absent', async () => {
    const { handle } = createTestDbWithUser();
    const req = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const res = await postStripeWebhook(req, {
      db: handle.db,
      secret: STRIPE_SECRET,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing_signature_header');
  });

  test('400 invalid_signature when HMAC does not match', async () => {
    const { handle } = createTestDbWithUser();
    const tsSec = Math.floor(Date.now() / 1000);
    const req = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Stripe-Signature': `t=${tsSec},v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'evt_x', type: 'invoice.paid' }),
    });
    const res = await postStripeWebhook(req, {
      db: handle.db,
      secret: STRIPE_SECRET,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_signature');
  });

  test('200 received:true when signature is valid (known event)', async () => {
    const { handle } = createTestDbWithUser();
    const payload = JSON.stringify({
      id: 'evt_chk',
      type: 'checkout.session.completed',
    });
    const req = await buildSignedStripeRequest(payload, STRIPE_SECRET);
    const res = await postStripeWebhook(req, {
      db: handle.db,
      secret: STRIPE_SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { received: boolean; type: string };
    expect(body.received).toBe(true);
    expect(body.type).toBe('checkout.session.completed');
  });

  test('200 received:true + ignored:true on unknown event type', async () => {
    const { handle } = createTestDbWithUser();
    const payload = JSON.stringify({
      id: 'evt_x',
      type: 'random.unknown.event',
    });
    const req = await buildSignedStripeRequest(payload, STRIPE_SECRET);
    const res = await postStripeWebhook(req, {
      db: handle.db,
      secret: STRIPE_SECRET,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      received: boolean;
      type: string;
      ignored?: boolean;
    };
    expect(body.received).toBe(true);
    expect(body.ignored).toBe(true);
  });

  test('400 when timestamp drift exceeds 300s', async () => {
    const { handle } = createTestDbWithUser();
    const payload = JSON.stringify({ id: 'evt_old', type: 'invoice.paid' });
    const tsSec = Math.floor(Date.now() / 1000) - 600;
    const req = await buildSignedStripeRequest(payload, STRIPE_SECRET, tsSec);
    const res = await postStripeWebhook(req, {
      db: handle.db,
      secret: STRIPE_SECRET,
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_signature');
  });

  test('200 even when db is null (no audit possible) — best-effort parity', async () => {
    const payload = JSON.stringify({ id: 'evt_chk2', type: 'invoice.paid' });
    const req = await buildSignedStripeRequest(payload, STRIPE_SECRET);
    const res = await postStripeWebhook(req, {
      db: null,
      secret: STRIPE_SECRET,
    });
    expect(res.status).toBe(200);
  });

  test('pentest H-10: replayed event returns 200 duplicate:true and does not re-process', async () => {
    // The first POST inserts a `processed_stripe_events` row; ON CONFLICT
    // DO NOTHING makes the second POST a no-op aside from the 200 ack.
    // (Audit-log side effects use the org_id as station_id which trips the
    // station FK in pg-mem and is silently swallowed — that's existing
    // parity with the Cloudflare side, not part of this fix.)
    const { handle } = createTestDbWithUser();
    const payload = JSON.stringify({
      id: 'evt_replay_1',
      type: 'invoice.paid',
      data: { object: { metadata: { org_id: 'org-test' } } },
    });

    // First delivery → normal processing.
    const req1 = await buildSignedStripeRequest(payload, STRIPE_SECRET);
    const res1 = await postStripeWebhook(req1, {
      db: handle.db,
      secret: STRIPE_SECRET,
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { received: boolean; duplicate?: boolean };
    expect(body1.received).toBe(true);
    expect(body1.duplicate).toBeUndefined();

    // Dedup row was created.
    const processedRows = handle.mem.public.many(
      "SELECT event_id, type FROM processed_stripe_events WHERE event_id = 'evt_replay_1'",
    ) as Array<{ event_id: string; type: string }>;
    expect(processedRows).toHaveLength(1);
    expect(processedRows[0].type).toBe('invoice.paid');

    // Second delivery (replay) — must short-circuit before re-running side effects.
    const req2 = await buildSignedStripeRequest(payload, STRIPE_SECRET);
    const res2 = await postStripeWebhook(req2, {
      db: handle.db,
      secret: STRIPE_SECRET,
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { received: boolean; duplicate?: boolean };
    expect(body2.received).toBe(true);
    expect(body2.duplicate).toBe(true);

    // No second dedup row.
    const processedAfterReplay = handle.mem.public.many(
      "SELECT COUNT(*)::int AS c FROM processed_stripe_events WHERE event_id = 'evt_replay_1'",
    ) as Array<{ c: number }>;
    expect(Number(processedAfterReplay[0].c)).toBe(1);
  });

  test('audit-log parity fix: writes audit row anchored on org’s first station', async () => {
    // The webhook stores org-level events on the org's first station
    // (audit_log.station_id has a FK to stations.id NOT NULL). This test
    // confirms the lookup + audit insert actually lands.
    const { handle } = createTestDbWithUser();

    // Sanity check: the seed actually created the station we expect.
    const stationsRows = handle.mem.public.many(
      "SELECT id, org_id FROM stations WHERE org_id = 'org-test'",
    ) as Array<{ id: string; org_id: string }>;
    expect(stationsRows).toEqual([{ id: 'station-test', org_id: 'org-test' }]);

    const payload = JSON.stringify({
      id: 'evt_audit_test',
      type: 'invoice.paid',
      data: { object: { metadata: { org_id: 'org-test' } } },
    });

    const res = await postStripeWebhook(
      await buildSignedStripeRequest(payload, STRIPE_SECRET),
      { db: handle.db, secret: STRIPE_SECRET },
    );
    expect(res.status).toBe(200);

    // System-generated Stripe events use NULL actor_user_id (the FK to
    // auth_users would otherwise reject any sentinel). Filter on the
    // action name pattern instead.
    const auditRows = handle.mem.public.many(
      "SELECT station_id, actor_user_id, action, target_id, after_json FROM audit_log WHERE action LIKE 'stripe_%'",
    ) as Array<{
      station_id: string;
      actor_user_id: string | null;
      action: string;
      target_id: string;
      after_json: string;
    }>;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0].station_id).toBe('station-test');
    expect(auditRows[0].actor_user_id).toBeNull();
    expect(auditRows[0].action).toBe('stripe_invoice.paid');
    expect(auditRows[0].target_id).toBe('org-test');
    const parsed = JSON.parse(auditRows[0].after_json) as {
      eventId: string;
      type: string;
      orgId: string;
      source: string;
    };
    expect(parsed.eventId).toBe('evt_audit_test');
    expect(parsed.orgId).toBe('org-test');
    expect(parsed.source).toBe('stripe');
  });

  test('audit-log parity fix: skips audit when org has no stations', async () => {
    // Fresh DB with an org but no stations under it.
    const handle = createTestDb();
    handle.mem.public.none(
      "INSERT INTO organizations (id, name, plan, created_at) VALUES ('org-no-stations', 'Lonely Org', 'free', '2026-01-01T00:00:00Z')",
    );

    const payload = JSON.stringify({
      id: 'evt_no_station',
      type: 'invoice.paid',
      data: { object: { metadata: { org_id: 'org-no-stations' } } },
    });

    const res = await postStripeWebhook(
      await buildSignedStripeRequest(payload, STRIPE_SECRET),
      { db: handle.db, secret: STRIPE_SECRET },
    );
    // Still 200 — Stripe doesn't need to retry; we just couldn't audit.
    expect(res.status).toBe(200);

    // Dedup row still written so future replays short-circuit.
    const dedupRows = handle.mem.public.many(
      "SELECT event_id FROM processed_stripe_events WHERE event_id = 'evt_no_station'",
    );
    expect(dedupRows).toHaveLength(1);

    // No audit row produced (no station to anchor to).
    const auditRows = handle.mem.public.many(
      "SELECT COUNT(*)::int AS c FROM audit_log WHERE action LIKE 'stripe_%'",
    ) as Array<{ c: number }>;
    expect(Number(auditRows[0].c)).toBe(0);
  });

  test('pentest H-10: different event ids are NOT deduped against each other', async () => {
    const { handle } = createTestDbWithUser();
    const payloadA = JSON.stringify({ id: 'evt_a', type: 'invoice.paid' });
    const payloadB = JSON.stringify({ id: 'evt_b', type: 'invoice.paid' });

    const resA = await postStripeWebhook(
      await buildSignedStripeRequest(payloadA, STRIPE_SECRET),
      { db: handle.db, secret: STRIPE_SECRET },
    );
    const resB = await postStripeWebhook(
      await buildSignedStripeRequest(payloadB, STRIPE_SECRET),
      { db: handle.db, secret: STRIPE_SECRET },
    );

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const bodyA = (await resA.json()) as { duplicate?: boolean };
    const bodyB = (await resB.json()) as { duplicate?: boolean };
    expect(bodyA.duplicate).toBeUndefined();
    expect(bodyB.duplicate).toBeUndefined();

    const rows = handle.mem.public.many(
      'SELECT event_id FROM processed_stripe_events ORDER BY event_id',
    ) as Array<{ event_id: string }>;
    expect(rows.map((r) => r.event_id)).toEqual(['evt_a', 'evt_b']);
  });
});
