# Production Runbook — Phase 8 hardening

This document tells an operator how to flip Sonic Bloom from "demo mode" to "production-grade" once external credentials become available. Everything in Phase 8 is designed to be a **no-op without credentials**; the same code path activates as soon as the matching environment variable is set.

> Audience: on-call engineer, SRE, founder shipping the first paid plan.
> Last updated: Phase 8 scaffolding PR.

## 1. Quick-glance status

| Capability                  | Code lives at                                | Activates when…                          |
| --------------------------- | -------------------------------------------- | ---------------------------------------- |
| Uptime probe (`/api/healthz`) | `functions/api/healthz.ts`                  | Always on (public).                      |
| Status page (`/api/status`) | `functions/api/status.ts`                    | Always on (public).                      |
| Stripe webhook              | `functions/api/webhooks/stripe.ts`           | `STRIPE_WEBHOOK_SECRET` is set.          |
| Server-side error tracking  | `functions/_lib/observability.ts`            | `SENTRY_DSN` is set.                     |
| Browser error tracking      | `src/lib/sentry-client.ts`                   | `NEXT_PUBLIC_SENTRY_DSN` is set.         |
| Nightly D1 → R2 backup      | `scripts/backup-d1-to-r2.mjs`                | Cron schedules `npm run backup`.         |

## 2. Setting environment variables

### Local development

Add to `.dev.vars` (gitignored). Template lives in `.dev.vars.example`. Example:

```
STRIPE_WEBHOOK_SECRET=whsec_local_test_secret_from_stripe_cli
SENTRY_DSN=https://example@o0.ingest.sentry.io/0
BACKUP_BUCKET=sonic-bloom-media
```

Browser-side `NEXT_PUBLIC_SENTRY_DSN` belongs in `.env.local` so Next.js inlines it at build time.

### Cloudflare Pages — production

Two paths, pick one per variable:

1. **Dashboard** — Cloudflare → Workers & Pages → your project → Settings → Environment Variables → Production. Add and click "Encrypt" for secrets.
2. **wrangler CLI** —

   ```sh
   wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name homeseeker
   wrangler pages secret put SENTRY_DSN --project-name homeseeker
   wrangler pages secret put BACKUP_BUCKET --project-name homeseeker
   ```

`NEXT_PUBLIC_*` variables are NOT secrets — they ship to the browser. Add them as plain env vars in the dashboard (or via `wrangler pages env`).

## 3. Stripe webhook setup

1. In the Stripe dashboard → Developers → Webhooks → "Add endpoint".
2. URL: `https://<your-domain>/api/webhooks/stripe`
3. Events to subscribe to:
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the **signing secret** (starts with `whsec_…`).
5. Set `STRIPE_WEBHOOK_SECRET` in Pages (see §2).

### What each event does today

| Event                              | Today                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `checkout.session.completed`       | Writes one `audit_log` row, `action='stripe_checkout.session.completed'`.         |
| `invoice.paid`                     | Writes one `audit_log` row, `action='stripe_invoice.paid'`.                       |
| `customer.subscription.updated`    | Writes one `audit_log` row, `action='stripe_customer.subscription.updated'`.     |
| `customer.subscription.deleted`    | Writes one `audit_log` row, `action='stripe_customer.subscription.deleted'`.     |
| Anything else                      | Returns 200 OK without writing (Stripe expects 2xx for ignored events).           |

### Follow-up R1 ticket — plan promotion

The handler intentionally does NOT mutate `organizations.plan` yet. To flip it on:

1. Add an `organizations.stripe_customer_id` UNIQUE column via migration (already named `billing_customer_id` from `0004_radio_schema.sql` — reuse that).
2. Wire each event handler in `stripe.ts` to look up the org by `data.object.customer` or `data.object.client_reference_id`.
3. Update `organizations.plan` based on the active subscription's `price.lookup_key` or `metadata.plan`.

### Plan tiers (intended)

| Tier        | Triggered by                                                                | Capabilities                            |
| ----------- | --------------------------------------------------------------------------- | --------------------------------------- |
| `free`      | Default for every new org (created via `0005_default_org_station.sql`).     | 1 station, 1 user, 100 tracks.          |
| `starter`   | `checkout.session.completed` + subscription `starter`.                      | 1 station, 5 users, unlimited catalog.  |
| `pro`       | `customer.subscription.updated` to `pro` price.                             | 5 stations, 25 users.                   |
| `enterprise`| Custom flow (no public price). Set via admin endpoint.                      | Unlimited stations + users.             |
| (none)      | `customer.subscription.deleted` → revert to `free`.                         | n/a.                                    |

### Verifying the webhook in production

```sh
# Trigger a test event from the Stripe dashboard, then:
wrangler tail homeseeker --format pretty | grep stripe-webhook
```

Expected log line on success: `[stripe-webhook] handling event { id: 'evt_…', type: '…' }`.

Failures with `invalid_signature` usually mean the wrong webhook secret is set OR the body was rewritten by a proxy (Cloudflare itself does NOT touch POST bodies for `/api/*` routes — but a custom rule could).

## 4. Sentry setup

1. Create a project in Sentry → choose "JavaScript → Next.js" for browser, "Node.js → Cloudflare Workers" for server (different DSNs).
2. Set the two env vars:
   - `SENTRY_DSN` — server-side DSN.
   - `NEXT_PUBLIC_SENTRY_DSN` — browser DSN.
3. Phase 8 ships a **stub adapter** — when the DSN is set, errors log via `console.error` with a `[observability]` tag. The follow-up PR (tracked as "wire toucan-js for Cloudflare Workers") will swap the body of `initObservability` to call `toucan-js.captureException` instead. **No callsite changes required.**

### What the stub gives you today

- Every `captureError(env, err, ctx)` call is a no-op without DSN, a structured log with DSN.
- Browser: `initSentryClient` already SSR-safe and DSN-gated.

### Adding the real Sentry SDK (follow-up)

```sh
npm install --save @sentry/cloudflare-workers @sentry/nextjs
# Then in functions/_lib/observability.ts:
#   import { Toucan } from 'toucan-js';
#   return new Toucan({ dsn, request, context });
# In src/app/sentry.client.config.ts:
#   import * as Sentry from '@sentry/nextjs';
#   Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN });
```

## 5. D1 → R2 backups

### Script

`scripts/backup-d1-to-r2.mjs` runs `wrangler d1 export` then `wrangler r2 object put`. The script is shell-free (uses `spawnSync` with argv arrays), so env-derived values cannot escape into command injection. Keys are dated, so backups never overwrite each other:

```
r2://<BACKUP_BUCKET>/backups/sonic-bloom-db-2026-05-14T21-30-00.000Z.sql
```

### Run on demand

```sh
BACKUP_BUCKET=sonic-bloom-backups npm run backup
```

### Schedule — GitHub Actions (recommended for v1)

`.github/workflows/backup.yml` (not shipped — paste manually):

```yaml
name: nightly-d1-backup
on:
  schedule:
    - cron: '17 3 * * *'    # 03:17 UTC nightly
  workflow_dispatch: {}
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          BACKUP_BUCKET: ${{ secrets.BACKUP_BUCKET }}
        run: npm run backup
```

API token scope: `Account → D1 (Read)` + `Account → R2 (Edit)`.

### Schedule — Cloudflare Cron (alternative)

Use a Worker with a Cron Trigger. Out of scope for Phase 8; see <https://developers.cloudflare.com/workers/configuration/cron-triggers/>.

### Restore drill

```sh
wrangler r2 object get sonic-bloom-backups/backups/sonic-bloom-db-2026-05-14T21-30-00.000Z.sql --file=restore.sql
wrangler d1 execute sonic-bloom-db --remote --file=restore.sql
```

Run a restore drill at least once before relying on backups in production.

## 6. Monitoring

| Surface              | Where                                          | Why                                        |
| -------------------- | ---------------------------------------------- | ------------------------------------------ |
| Uptime               | Better Stack / UptimeRobot pinging `/api/healthz` every 60s. | Detects total outages.   |
| Deep uptime          | Same monitor with `?probe=db` every 5min.      | Detects D1 outages.                        |
| Error tracking       | Sentry (once DSN set).                         | Stack traces with breadcrumbs.             |
| Build/runtime logs   | Cloudflare → Workers & Pages → Logs → Live.    | Real-time stdout/stderr.                   |
| Stripe events        | Stripe dashboard → Webhooks → endpoint detail. | Per-event delivery status & retries.       |
| Public status        | `/api/status` JSON, surface in a status page.  | Encoder + scheduler + last broadcast.      |

### What to alert on

- `/api/healthz` returns non-200 for > 2 minutes.
- `/api/healthz?probe=db` returns 503 for > 5 minutes (DB degraded).
- Sentry error volume spikes > 3x baseline.
- Stripe webhook delivery failure rate > 5%.
- Nightly backup job fails 2 nights in a row.

## 7. Rollback procedures

### Stripe webhook broken

1. **Fastest**: unset `STRIPE_WEBHOOK_SECRET` via Pages dashboard. The handler returns 503 `stripe_not_configured`, Stripe retries (24h window), no payments are lost — they remain pending in Stripe.
2. **Code fix**: revert the offending commit and redeploy. Re-set `STRIPE_WEBHOOK_SECRET`.

### Sentry sending too much / leaking PII

1. Unset `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`. Code falls back to console-only.
2. Add scrubbing rules in Sentry → Settings → Data Scrubbers before flipping back on.

### Backup script failing

1. Backups are write-only; a failure does not impact production traffic.
2. Run the script manually with `BACKUP_BUCKET=… npm run backup` to capture stderr.
3. Common causes: `CLOUDFLARE_API_TOKEN` missing/expired; R2 bucket doesn't exist; D1 export hitting Cloudflare rate limits at scale (rare).

### Status page leaking data

`/api/status` is INTENTIONALLY public. It exposes only:
- A boolean `encoder.connected`.
- A `listeners` count (always 0 for stub).
- A scheduler heartbeat timestamp.
- A last-broadcast timestamp.

If you need to take it down, deploy a one-line patch that returns `{ ok: false }` with status 503, or remove the route from `isPublicApiRoute` and let session auth gate it.

## 8. Phase 8 checklist for ops

Before declaring Phase 8 production-live:

- [ ] `STRIPE_WEBHOOK_SECRET` set in Pages production.
- [ ] Stripe dashboard endpoint configured with the 4 events listed in §3.
- [ ] One test Stripe event delivered successfully (check audit_log).
- [ ] `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` set; one deliberate test error captured (run `throw new Error('sentry test')` from a handler).
- [ ] `BACKUP_BUCKET` set; manual `npm run backup` succeeds.
- [ ] GitHub Actions backup workflow scheduled.
- [ ] Restore drill from a real backup completed against a scratch DB.
- [ ] Uptime monitor pinging `/api/healthz` every 60s with paging on failure.
- [ ] `/api/status` surfaced on a public status page.

When the follow-up "real Sentry SDK" PR lands, this checklist gains:

- [ ] `@sentry/cloudflare-workers` installed.
- [ ] `toucan-js` swap in `functions/_lib/observability.ts` deployed.
- [ ] Source maps uploaded to Sentry for each release (`sentry-cli releases new …`).
