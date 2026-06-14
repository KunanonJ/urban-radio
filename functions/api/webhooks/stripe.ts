/// <reference types="@cloudflare/workers-types" />

import type { SonicBloomEnv } from '../../_lib/env';
import { writeAuditLog } from '../../_lib/audit-log';
import { verifyStripeSignature, type StripeEvent } from '../../_lib/stripe-verify';

interface StripeEnv {
  STRIPE_WEBHOOK_SECRET?: string;
}

type Ctx = { env: SonicBloomEnv & StripeEnv; request: Request };

/**
 * The subset of Stripe event types we recognize today. Each one writes an
 * audit row keyed as `action='stripe_<event>'`. Anything outside this set
 * is acknowledged with 200 so Stripe doesn't keep retrying — Stripe expects
 * 2xx even for "ignored" events.
 *
 * IMPORTANT: this handler does NOT mutate `organizations.plan` or any other
 * billing state today. Plan promotion / downgrade is a follow-up R1 ticket
 * that needs the org → stripe-customer mapping populated first. See
 * `docs/PRODUCTION-RUNBOOK.md` for the migration path.
 */
const KNOWN_EVENTS = new Set<string>([
  'checkout.session.completed',
  'invoice.paid',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/**
 * Extracts the org id from a Stripe event payload, if present. Stripe's
 * convention is to put our reference in `client_reference_id` (for Checkout)
 * or in `metadata.org_id`. We treat both as optional and fall back to null.
 */
function extractOrgId(event: StripeEvent): string | null {
  const obj = event?.data?.object as
    | { client_reference_id?: unknown; metadata?: { org_id?: unknown } }
    | undefined;
  if (!obj) return null;
  if (typeof obj.client_reference_id === 'string' && obj.client_reference_id.trim()) {
    return obj.client_reference_id.trim();
  }
  if (
    obj.metadata &&
    typeof obj.metadata.org_id === 'string' &&
    obj.metadata.org_id.trim()
  ) {
    return obj.metadata.org_id.trim();
  }
  return null;
}

export async function onRequestPost(ctx: Ctx): Promise<Response> {
  const { env, request } = ctx;
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();

  // No-op gate: without a secret, the handler refuses everything. This is
  // intentional — we don't want a forgotten misconfiguration to accept
  // unauthenticated POSTs that look like webhooks.
  if (!secret) {
    return json(503, { error: 'stripe_not_configured' });
  }

  const sigHeader = request.headers.get('Stripe-Signature') ?? '';
  if (!sigHeader) {
    return json(400, { error: 'missing_signature_header' });
  }

  // Stripe REQUIRES the raw body — JSON.parse(then stringify) breaks the HMAC.
  let payload: string;
  try {
    payload = await request.text();
  } catch (err) {
    console.error('[stripe-webhook] body read failed', err);
    return json(400, { error: 'invalid_body' });
  }

  const verify = await verifyStripeSignature({
    payload,
    signature: sigHeader,
    secret,
  });

  if (!verify.ok) {
    console.warn('[stripe-webhook] signature verification failed:', verify.error);
    return json(400, { error: 'invalid_signature' });
  }

  const event = verify.event;
  const type = typeof event.type === 'string' ? event.type : 'unknown';
  const eventId = typeof event.id === 'string' ? event.id : 'unknown';

  if (!KNOWN_EVENTS.has(type)) {
    console.info('[stripe-webhook] ignored event', { id: eventId, type });
    return json(200, { received: true, type, ignored: true });
  }

  console.info('[stripe-webhook] handling event', { id: eventId, type });

  // Best-effort audit log. Failure must not 500 — Stripe will retry forever.
  if (env.DB) {
    const orgId = extractOrgId(event);
    await writeAuditLog(env.DB, {
      stationId: orgId ?? 'unknown',
      actorUserId: 'stripe',
      action: `stripe_${type}`,
      targetType: 'organization',
      targetId: orgId ?? eventId,
      after: { eventId, type },
    });
  }

  return json(200, { received: true, type });
}

export const onRequest = async (ctx: Ctx): Promise<Response> => {
  if (ctx.request.method === 'POST') return onRequestPost(ctx);
  return new Response('Method Not Allowed', { status: 405 });
};
