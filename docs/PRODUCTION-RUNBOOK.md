# Production Runbook — Phase 8 hardening

This document tells an operator how to flip Sonic Bloom from "demo mode" to "production-grade" once external credentials become available. Everything in Phase 8 is designed to be a **no-op without credentials**; the same code path activates as soon as the matching environment variable is set.

> Audience: on-call engineer, SRE, founder shipping the first paid plan.
> Last updated: Phase 8 scaffolding PR.
>
> **2026-06 note (Railway migration):** the runtime is now Next.js (App Router, standalone) on Railway via Docker, with Postgres (Drizzle) and S3-compatible (R2) storage. References below have been updated from the legacy Cloudflare Pages/D1 stack; the active API handlers live under `src/app/api/*/route.ts`, not `functions/api/*.ts`.

## 1. Quick-glance status

| Capability                  | Code lives at                                | Activates when…                          |
| --------------------------- | -------------------------------------------- | ---------------------------------------- |
| Uptime probe (`/api/healthz`) | `src/app/api/healthz/route-impl.ts`         | Always on (public).                      |
| Status page (`/api/status`) | `src/app/api/status/route-impl.ts`           | Always on (public).                      |
| Stripe webhook              | `src/app/api/webhooks/stripe/route-impl.ts`  | `STRIPE_WEBHOOK_SECRET` is set.          |
| Server-side error tracking  | `functions/_lib/observability.ts` (legacy stub) | `SENTRY_DSN` is set.                  |
| Browser error tracking      | `src/lib/sentry-client.ts`                   | `NEXT_PUBLIC_SENTRY_DSN` is set.         |
| Nightly Postgres → S3 backup | `scripts/backup-pg-to-s3.mjs`               | `pg-backup.yml` cron runs `npm run backup:pg`. |

## 2. Setting environment variables

### Local development

Add to `.env` / `.env.local` (gitignored). Templates live in `.env.example` and `.env.local.example`. Example:

```
DATABASE_URL=postgresql://sonic:sonic@localhost:5432/sonic_bloom
STRIPE_WEBHOOK_SECRET=whsec_local_test_secret_from_stripe_cli
STORAGE_BUCKET=sonic-bloom-media
```

Local dev Postgres comes from `docker-compose.dev.yml` (`npm run db:up`); apply schema with `npm run db:migrate`.

Browser-side `NEXT_PUBLIC_SENTRY_DSN` belongs in `.env.local` so Next.js inlines it at build time.

### Railway — production

Set production variables on the Railway service:

1. **Dashboard** — Railway → your project → the service → Variables. Add each variable; secrets are stored encrypted.
2. **Railway CLI** —

   ```sh
   railway variables --set STRIPE_WEBHOOK_SECRET=whsec_…
   railway variables --set AUTH_JWT_SECRET=…
   railway variables --set STORAGE_BUCKET=sonic-bloom-media
   ```

`NEXT_PUBLIC_*` variables are NOT secrets — they ship to the browser and are inlined at build time, so they must be present in the build environment too.

## 3. Stripe webhook setup

1. In the Stripe dashboard → Developers → Webhooks → "Add endpoint".
2. URL: `https://<your-domain>/api/webhooks/stripe`
3. Events to subscribe to:
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Copy the **signing secret** (starts with `whsec_…`).
5. Set `STRIPE_WEBHOOK_SECRET` on Railway (see §2).

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
# Trigger a test event from the Stripe dashboard, then tail the Railway logs:
railway logs | grep stripe-webhook
```

Expected log line on success: `[stripe-webhook] handling event { id: 'evt_…', type: '…' }`.

Failures with `invalid_signature` usually mean the wrong webhook secret is set OR the request body was rewritten before reaching the handler (a proxy or middleware that re-parses POST bodies).

## 4. Sentry setup

1. Create a project in Sentry → choose "JavaScript → Next.js" for browser, "Node.js" for server (different DSNs).
2. Set the two env vars:
   - `SENTRY_DSN` — server-side DSN.
   - `NEXT_PUBLIC_SENTRY_DSN` — browser DSN.
3. There is no active server-side Sentry adapter yet — the App Router routes under `src/app/api/*` log errors via `console.error` (and `src/server/internal-error.ts`), which Railway captures in its logs. The legacy `functions/_lib/observability.ts` stub is a Cloudflare-Workers-era artifact and is NOT wired into the current Node runtime; wiring `@sentry/nextjs` is a follow-up.

### What's wired today

- Server: API routes log errors to stdout/stderr via `console.error`; Railway captures these in its log stream. No DSN-gated server client is active yet.
- Browser: `src/lib/sentry-client.ts` `initSentryClient` is SSR-safe and DSN-gated — a no-op without `NEXT_PUBLIC_SENTRY_DSN`, a thin console-backed `captureException` client with it.

### Adding the real Sentry SDK (follow-up)

```sh
npm install --save @sentry/nextjs
# Browser + server are both covered by @sentry/nextjs on a Node runtime:
#   In sentry.client.config.ts:
#     import * as Sentry from '@sentry/nextjs';
#     Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN });
#   In sentry.server.config.ts:
#     Sentry.init({ dsn: process.env.SENTRY_DSN });
```

## 5. Postgres → S3 backups

### Script

`scripts/backup-pg-to-s3.mjs` runs `pg_dump --format=custom --no-owner` against `DATABASE_URL`, uploads the dump to the S3-compatible bucket (`@aws-sdk/client-s3`), then optionally prunes objects older than `BACKUP_RETENTION_DAYS`. The dump is invoked via `spawnSync` with `shell:false`, so env-derived values cannot escape into command injection. Keys are dated, so backups never overwrite each other:

```
s3://<STORAGE_BUCKET>/<BACKUP_PREFIX>sonic-bloom-pg-2026-05-14T21-30-00-000Z.dump
```

`BACKUP_PREFIX` defaults to `backups/pg/`; `STORAGE_REGION` defaults to `auto` (R2).

### Run on demand

```sh
npm run backup:pg
```

Requires `DATABASE_URL` and the `STORAGE_*` vars. Set `BACKUP_DRY_RUN=1` to dump without uploading.

### Schedule — GitHub Actions (shipped)

`.github/workflows/pg-backup.yml` already runs nightly (`cron: '17 3 * * *'`, 03:17 UTC) and on `workflow_dispatch`. It installs the Postgres client, runs `npm run backup:pg`, and reads these from repo secrets: `DATABASE_URL`, `STORAGE_ENDPOINT_URL`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_REGION`, `BACKUP_PREFIX`, `BACKUP_RETENTION_DAYS`.

### Restore drill

```sh
# Download the dump from the S3-compatible bucket (e.g. with the aws CLI against the R2 endpoint), then:
pg_restore --no-owner --dbname "$DATABASE_URL" sonic-bloom-pg-2026-05-14T21-30-00-000Z.dump
```

Run a restore drill at least once before relying on backups in production.

## 6. Monitoring

| Surface              | Where                                          | Why                                        |
| -------------------- | ---------------------------------------------- | ------------------------------------------ |
| Uptime               | Better Stack / UptimeRobot pinging `/api/healthz` every 60s. | Detects total outages.   |
| Deep uptime          | Same monitor with `?probe=db` every 5min.      | Detects Postgres outages.                  |
| Error tracking       | Sentry (once DSN set).                         | Stack traces with breadcrumbs.             |
| Build/runtime logs   | Railway → your service → Deployments → Logs (or `railway logs`). | Real-time stdout/stderr.   |
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

1. **Fastest**: unset `STRIPE_WEBHOOK_SECRET` via the Railway dashboard. The handler returns 503 `stripe_not_configured`, Stripe retries (24h window), no payments are lost — they remain pending in Stripe.
2. **Code fix**: revert the offending commit and redeploy. Re-set `STRIPE_WEBHOOK_SECRET`.

### Sentry sending too much / leaking PII

1. Unset `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`. Code falls back to console-only.
2. Add scrubbing rules in Sentry → Settings → Data Scrubbers before flipping back on.

### Backup script failing

1. Backups are write-only; a failure does not impact production traffic.
2. Run the script manually with `npm run backup:pg` (env: `DATABASE_URL` + `STORAGE_*`) to capture stderr.
3. Common causes: `STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY` missing or invalid; the `STORAGE_BUCKET` doesn't exist; `pg_dump` not installed or unable to reach `DATABASE_URL`.

### Status page leaking data

`/api/status` is INTENTIONALLY public. It exposes only:
- A boolean `encoder.connected`.
- A `listeners` count (always 0 for stub).
- A scheduler heartbeat timestamp.
- A last-broadcast timestamp.

If you need to take it down, deploy a one-line patch that returns `{ ok: false }` with status 503, or remove the route from `isPublicApiRoute` and let session auth gate it.

## 8. Phase 8 checklist for ops

Before declaring Phase 8 production-live:

- [ ] `STRIPE_WEBHOOK_SECRET` set on Railway production.
- [ ] Stripe dashboard endpoint configured with the 4 events listed in §3.
- [ ] One test Stripe event delivered successfully (check audit_log).
- [ ] `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` set; one deliberate test error captured (run `throw new Error('sentry test')` from a handler).
- [ ] `STORAGE_*` set; manual `npm run backup:pg` succeeds.
- [ ] GitHub Actions `pg-backup.yml` workflow scheduled (secrets populated).
- [ ] Restore drill from a real backup completed against a scratch DB.
- [ ] Uptime monitor pinging `/api/healthz` every 60s with paging on failure.
- [ ] `/api/status` surfaced on a public status page.

When the follow-up "real Sentry SDK" PR lands, this checklist gains:

- [ ] `@sentry/nextjs` installed.
- [ ] `sentry.client.config.ts` + `sentry.server.config.ts` wired and deployed.
- [ ] Source maps uploaded to Sentry for each release (`sentry-cli releases new …`).
