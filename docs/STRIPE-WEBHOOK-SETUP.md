# Stripe webhook setup — Sonic Bloom

**Endpoint:** `POST https://sonic-bloom-web-production.up.railway.app/api/webhooks/stripe`
**Status today:** `STRIPE_WEBHOOK_SECRET` unset → endpoint returns **503 `stripe_not_configured`**. Stripe will retry with exponential backoff for ~3 days. Setting the secret flips it live; no redeploy needed.

---

## 1. What the webhook does today (and doesn't)

### What it does
- **Verifies signatures** — HMAC-SHA256 of `<timestamp>.<rawBody>` against `STRIPE_WEBHOOK_SECRET`, constant-time compare, ±300s timestamp drift window.
- **Replay-protects** — every `event.id` is inserted into the `processed_stripe_events` table with `ON CONFLICT DO NOTHING`. A replayed event short-circuits to `200 {duplicate: true}` without re-running side effects. (Pentest H-10.)
- **Audit-logs** — every successfully-verified, non-duplicate event writes one `audit_log` row tagged `stripe_<event-type>`.

### Allow-listed event types (handler explicitly knows about these)
- `checkout.session.completed`
- `invoice.paid`
- `customer.subscription.updated`
- `customer.subscription.deleted`

Other event types still get `200 {ignored: true}` (Stripe stops retrying), but no audit row is written.

### What it does NOT do yet
- **No `organizations.plan` mutation.** This is the next-feature ticket. The audit log records the event for later reconciliation; the plan column itself is never written from the webhook. If you change plans today, you must update `organizations.plan` directly via SQL or the Settings UI.
- **No customer-to-org linking is enforced.** The webhook reads org id from the payload as documented below, then resolves it to the org's earliest-created station (`audit_log.station_id` is a FK to `stations.id`). If the payload carries no org id, or the org has no station, the audit write is skipped and the handler logs `audit skipped (no station for org)` — the event is still 200'd and recorded in the dedup table.
- **No retries-of-our-own.** When the audit write is skipped (or `writeAuditLog` swallows an unexpected error), the event is still marked processed in the dedup table so Stripe doesn't retry. This is intentional but means you'll need to backfill manually from `processed_stripe_events` if it happens.

---

## 2. Linking customers to your orgs

The handler extracts `orgId` from the event payload in this order:

1. **`data.object.client_reference_id`** — used by Stripe Checkout. Set this to your `organizations.id` when creating the Checkout Session.
2. **`data.object.metadata.org_id`** — used by everything else (subscription update, invoice paid, etc.). Set `metadata: { org_id: "<your-org-id>" }` on the underlying object (Customer, Subscription, or Invoice line).

If neither is present (or the resolved org has no station), the audit write is skipped entirely and the handler logs `audit skipped (no station for org)`. The webhook still returns 200 — the event isn't lost (it's recorded in `processed_stripe_events`), you just can't tie it back to an org later without manual reconciliation. When an org **is** resolved, the audit row's `target_id` is the org id (falling back to the `event.id` only if the org id is somehow absent).

**Example Checkout Session payload:**
```json
{
  "client_reference_id": "sonic-bloom",
  "metadata": { "org_id": "sonic-bloom" },
  "line_items": [...]
}
```

(Set both — `client_reference_id` for checkout events, `metadata.org_id` so subsequent subscription/invoice events also resolve.)

---

## 3. Step-by-step setup

### 3.1 Create the webhook in Stripe dashboard

1. Log in to [dashboard.stripe.com](https://dashboard.stripe.com).
2. Toggle to **Test mode** for the first setup (switch to Live mode after end-to-end works).
3. **Developers → Webhooks → Add endpoint**.
4. **Endpoint URL:** `https://sonic-bloom-web-production.up.railway.app/api/webhooks/stripe`
5. **API version:** Leave default (your account's latest).
6. **Events to send:** Click "Select events" → choose the four allowlisted types:
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   You can add more later; Sonic Bloom will `ignored: true` them safely.
7. Click **Add endpoint**.

### 3.2 Copy the signing secret

On the endpoint detail page, click **Reveal** under "Signing secret". The value starts with `whsec_...` (~60 chars).

### 3.3 Set it on Railway

From a terminal where `railway` CLI is logged in to your project:

```bash
railway variables --service sonic-bloom-web --set 'STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx...'
```

Railway auto-redeploys (~30s).

### 3.4 Verify

```bash
# Should return 503 BEFORE the secret is set, 400 invalid_signature AFTER (without Stripe-Signature header)
curl -i -X POST 'https://sonic-bloom-web-production.up.railway.app/api/webhooks/stripe' \
  -H 'Content-Type: application/json' \
  -d '{"id":"evt_test","type":"invoice.paid"}'
```

After the secret is set, you should see:
```
HTTP 400
{"error":"missing_signature_header"}
```

That's the right behavior — the endpoint accepts requests but rejects ones without a valid signature.

### 3.5 Send a test event from Stripe

On the webhook detail page, click **Send test webhook** → pick `checkout.session.completed`. The Stripe dashboard will show:
- **200 OK** with body `{"received":true,"type":"checkout.session.completed"}` — success
- **400** — signature mismatch (secret wrong or copy-paste error)
- **503** — secret still unset or DB unreachable

Repeat the test webhook a second time within 300s — you should get `{"received":true,"type":"checkout.session.completed","duplicate":true}`. That's the H-10 replay protection firing.

---

## 4. Local testing with Stripe CLI

For development, use Stripe CLI to forward events to your local Next dev server:

```bash
# Install (macOS)
brew install stripe/stripe-cli/stripe

# Authenticate
stripe login

# Forward to local dev (port 3000)
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

The CLI prints a one-time webhook secret (different from your dashboard one — for the forwarding session only). Set it in your `.env.local`:

```
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxx_FROM_STRIPE_LISTEN
```

Then trigger events:

```bash
stripe trigger checkout.session.completed
stripe trigger invoice.paid
stripe trigger customer.subscription.updated
stripe trigger customer.subscription.deleted
```

Watch the Stripe CLI terminal — it shows each event's status (200/400/503). Watch the Next dev server logs — `[stripe-webhook]` prefixed lines show what's happening server-side.

---

## 5. Reading the audit trail

After a successful event, query the audit log:

```sql
SELECT id, action, target_id, after_json, at
FROM audit_log
WHERE actor_user_id IS NULL AND action LIKE 'stripe_%'
ORDER BY at DESC
LIMIT 20;
```

(Stripe isn't an `auth_users` row, so the handler writes `actor_user_id = NULL` — filtering on `'stripe'` returns nothing. The `stripe_<event-type>` value lives in `action`.)

Each row's `after_json` carries `{ "eventId": "evt_...", "type": "...", "orgId": "...", "source": "stripe" }`. Cross-reference `eventId` against `processed_stripe_events` to confirm dedup is working:

```sql
SELECT * FROM processed_stripe_events ORDER BY processed_at DESC LIMIT 20;
```

---

## 6. Security properties already in place

| Property | Source | Notes |
|---|---|---|
| Constant-time HMAC compare | `src/server/stripe-verify.ts:verifyStripeSignature` | Uses `crypto.subtle.timingSafeEqual`-equivalent byte compare |
| Timestamp drift cap (±300s) | `stripe-verify.ts` | Rejects replays older / newer than 5 min from the upstream `t=` field |
| Replay protection (event-id dedup) | `processed_stripe_events` table, P0.7 | `INSERT … ON CONFLICT DO NOTHING RETURNING` — second delivery returns `{duplicate: true}` |
| Raw-body verification | `src/app/api/webhooks/stripe/route-impl.ts` | Reads `await request.text()` BEFORE any JSON parse so HMAC matches what Stripe signed |
| Fail-closed on dedup-store failure | Same file | If the `processed_stripe_events` INSERT itself throws, we return 503 so Stripe retries rather than risking double-handling |
| Secret never logged | `route-impl.ts` | Only an `[stripe-webhook] handling event { id, type }` log line; the secret itself stays in `process.env` |

---

## 7. Failure modes + troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| 503 `stripe_not_configured` | `STRIPE_WEBHOOK_SECRET` unset on Railway | `railway variables --service sonic-bloom-web --set 'STRIPE_WEBHOOK_SECRET=whsec_...'` |
| 400 `missing_signature_header` | Request has no `Stripe-Signature` header | Caller isn't Stripe — only Stripe should hit this endpoint |
| 400 `invalid_signature` | Secret in env doesn't match the one Stripe used to sign | Re-copy from Stripe dashboard. Whitespace / partial paste is the common culprit |
| 400 `invalid_signature` after correct secret | Body was modified between Stripe and our handler | Check for proxies / middleware that JSON-parse-and-re-stringify the body; we read `request.text()` raw |
| 400 `invalid_signature` only on old events | Timestamp drift > 300s | Stripe retries with the original timestamp; if the retry is past the 5-min window, it gets rejected. Acceptable — Stripe gives up after ~3 days anyway |
| 503 `dedup_store_unavailable` | Railway PG unreachable when handler tries to INSERT dedup row | Check Railway PG service health; the handler fail-closes to make Stripe retry |
| 200 `{ignored: true}` for an event you care about | Event type not in `KNOWN_EVENTS` allowlist | Add to `KNOWN_EVENTS` in `src/app/api/webhooks/stripe/route-impl.ts`; redeploy |
| Audit log row never appears | `org_id` not present in payload, or the resolved org has no station — the handler skips the audit write (logs `audit skipped (no station for org)`) since `audit_log.station_id` must point at a real `stations.id` | Set `metadata.org_id` on the Stripe object (and ensure the org has at least one station) OR plan to back-fill from `processed_stripe_events` later |
| Duplicate rows in audit log | Should be impossible — dedup table prevents re-processing | If this happens, dedup INSERT is failing silently. Check `processed_stripe_events` table exists + has the PK constraint |

---

## 8. Production checklist

Before flipping Stripe from test mode to live mode:

- [ ] Webhook secret set on Railway (`STRIPE_WEBHOOK_SECRET` populated)
- [ ] Send-test-webhook from Stripe dashboard returns 200 within 1s
- [ ] Replay-test (send same webhook twice) returns `duplicate: true` on the second
- [ ] `audit_log` and `processed_stripe_events` queries return the expected rows
- [ ] At least one end-to-end Checkout Session test from a real test card
- [ ] Map `organizations.id` ↔ Stripe customer / subscription id documented somewhere your team can find
- [ ] Decision made on plan-mutation path: SQL update, admin UI, or wait for the follow-up feature ticket
- [ ] Stripe `Restrict key` for the publishable key on the frontend (CSP `connect-src` already restricts)

---

## 9. When you're ready to add plan mutation

The follow-up feature ticket will:

1. Add `stripe_customer_id text` column on `organizations`.
2. On `checkout.session.completed`: set the customer id and bump plan to `'pro'` (or whatever the price maps to).
3. On `customer.subscription.updated`: re-evaluate plan based on the active price.
4. On `customer.subscription.deleted`: downgrade plan to `'free'`.
5. Race-safe: do this inside the same dedup transaction as the audit log write, so a partial processing leaves a clean state.

The current webhook is the minimum-viable bullet-proof layer; everything above is product feature work that builds on it.
