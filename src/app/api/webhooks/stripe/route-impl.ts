/**
 * POST /api/webhooks/stripe — Next.js port.
 *
 * Mirrors `functions/api/webhooks/stripe.ts`. PUBLIC route — no session
 * cookie / JWT check. Authentication is cryptographic, via Stripe's HMAC
 * signature header. Verification details live in `src/server/stripe-verify.ts`.
 *
 * Responses (byte-identical to the Cloudflare side):
 *   503 stripe_not_configured       — `STRIPE_WEBHOOK_SECRET` is unset
 *   400 missing_signature_header    — no `Stripe-Signature` request header
 *   400 invalid_body                — raw body read failed
 *   400 invalid_signature           — HMAC / timestamp check failed
 *   200 { received: true, type }                — known event handled
 *   200 { received: true, type, ignored: true } — unknown event acknowledged
 *
 * v1 SCOPE NOTE: this handler logs the event into `audit_log` but does NOT
 * mutate `organizations.plan`. Plan promotion / downgrade is a follow-up R1
 * ticket; see `functions/api/webhooks/stripe.ts` for context.
 *
 * See docs/RAILWAY-KICKOFF.md, Wave RM-β.
 */

import { asc, eq } from 'drizzle-orm';

import { getDb, type DbClient } from '@/db/client';
import { processedStripeEvents, stations } from '@/db/schema';
import { jsonError, methodNotAllowed } from '@/server/api-response';
import { writeAuditLog } from '@/server/audit-log';
import {
  verifyStripeSignature,
  type StripeEvent,
} from '@/server/stripe-verify';

/**
 * Resolve the first station belonging to an organization.
 *
 * Stripe events are org-scoped, but `audit_log.station_id` is a FK to
 * `stations.id` (NOT NULL). Without resolving an org → station mapping
 * the audit row would FK-violate and `writeAuditLog` would silently
 * swallow the error — leaving us with no audit trail for billing events.
 *
 * We pick the org's earliest-created station as a deterministic anchor:
 *   - Multi-station orgs: same station every time (stable for queries)
 *   - Single-station orgs: the obvious one
 *   - Zero-station orgs: returns null → caller logs + skips audit cleanly
 */
async function findFirstStationIdForOrg(
  db: DbClient,
  orgId: string,
): Promise<string | null> {
  try {
    const rows = await db
      .select({ id: stations.id })
      .from(stations)
      .where(eq(stations.orgId, orgId))
      .orderBy(asc(stations.createdAt), asc(stations.id))
      .limit(1);
    return rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

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
 * Pull the org id off the Stripe event payload, if present.
 *  - Checkout sessions: `data.object.client_reference_id`
 *  - Other event types: `data.object.metadata.org_id`
 * Returns null if neither is set.
 */
function extractOrgId(event: StripeEvent): string | null {
  const obj = event?.data?.object as
    | { client_reference_id?: unknown; metadata?: { org_id?: unknown } }
    | undefined;
  if (!obj) return null;
  if (
    typeof obj.client_reference_id === 'string' &&
    obj.client_reference_id.trim()
  ) {
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

export interface StripeWebhookDeps {
  db?: DbClient | null;
  /** Inject the webhook secret (tests). Defaults to `STRIPE_WEBHOOK_SECRET`. */
  secret?: string;
  /** Override "now" for verify (tests). */
  nowSec?: number;
}

export async function postStripeWebhook(
  request: Request,
  deps: StripeWebhookDeps = {},
): Promise<Response> {
  const secret = (deps.secret ?? process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();

  // Refuse everything when the secret isn't configured. We never want a
  // forgotten misconfiguration to accept unauthenticated POSTs that look
  // like webhooks.
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
    nowSec: deps.nowSec,
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

  // Pentest H-10: replay protection. Insert the event id with
  // `ON CONFLICT DO NOTHING RETURNING` — if zero rows come back the event
  // was already processed and we MUST NOT re-run side effects. Stripe
  // sees a 200 OK and stops retrying.
  //
  // `deps.db === null` is the explicit "audit disabled" branch — also
  // skips dedup since we have nowhere to record the processed id.
  if (deps.db !== null) {
    const db = deps.db ?? getDb();
    const processedAt = new Date().toISOString().replace(/\.\d+/, '');
    let firstTime = true;
    try {
      const inserted = await db
        .insert(processedStripeEvents)
        .values({ eventId, type, processedAt })
        .onConflictDoNothing()
        .returning({ eventId: processedStripeEvents.eventId });
      firstTime = inserted.length > 0;
    } catch (err) {
      // If the dedup table is unreachable, log loudly and FAIL-CLOSED — better
      // to make Stripe retry than to risk a double-handled event later.
      // eslint-disable-next-line no-console
      console.error('[stripe-webhook] dedup insert failed', err);
      return json(503, { error: 'dedup_store_unavailable' });
    }

    if (!firstTime) {
      console.info('[stripe-webhook] replay rejected', { id: eventId, type });
      return json(200, { received: true, type, duplicate: true });
    }

    console.info('[stripe-webhook] handling event', { id: eventId, type });

    // Audit-log Stripe parity fix: resolve org → first station so the
    // audit row's station_id FK actually points at a real `stations.id`.
    // Without this, every Stripe event silently dropped from audit_log
    // because `writeAuditLog` swallowed the FK violation. `actorUserId`
    // is set to null below because `audit_log.actor_user_id` has its own
    // FK to `auth_users.id` and Stripe isn't a user.
    const orgId = extractOrgId(event);
    let stationId: string | null = null;
    if (orgId) {
      stationId = await findFirstStationIdForOrg(db, orgId);
    }

    if (stationId) {
      await writeAuditLog(db, {
        stationId,
        // null = system-generated. The `auth_users.id` FK would reject
        // any sentinel string here.
        actorUserId: null,
        action: `stripe_${type}`,
        targetType: 'organization',
        targetId: orgId ?? eventId,
        after: { eventId, type, orgId, source: 'stripe' },
      });
    } else {
      // No station resolved — log loudly so ops can backfill from
      // `processed_stripe_events` later. The event still 200s; Stripe
      // doesn't need to retry, and the dedup row records that we saw it.
      // eslint-disable-next-line no-console
      console.warn('[stripe-webhook] audit skipped (no station for org)', {
        id: eventId,
        type,
        orgId,
      });
    }
  } else {
    console.info('[stripe-webhook] handling event (audit disabled)', {
      id: eventId,
      type,
    });
  }

  return json(200, { received: true, type });
}

export async function POST(request: Request): Promise<Response> {
  return postStripeWebhook(request);
}

export async function GET(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
export async function PUT(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
export async function PATCH(): Promise<Response> {
  return methodNotAllowed(['POST']);
}
export async function DELETE(): Promise<Response> {
  return methodNotAllowed(['POST']);
}

// Silence unused import warning during type-check on the deps signature.
void jsonError;
