# Monitoring setup — Sonic Bloom

Uptime probing + error alerting for the Railway-hosted web service.

**Base URL:** `https://sonic-bloom-web-production.up.railway.app`
**Primary probe:** `GET /api/healthz` — public, returns `{ ok, ts }`, no auth.
**Deep probe:** `GET /api/healthz?probe=db` — actively pings Postgres (slow path; 200 when connected, 503 when not).

---

## 1. What each endpoint exposes

All three are public per the allow-list in `src/server/auth/require-session.ts` (`isPublicApiRoute`), so an external monitor reaches them without a session.

| Endpoint | Auth | Returns | Use for |
|---|---|---|---|
| `GET /api/healthz` | public | `{ ok: true, ts }` — bare liveness, no DB touch | Uptime monitors. Fast, cheap, won't load the DB. |
| `GET /api/healthz?probe=db` | public | `{ ok, ts, db: 'connected' \| 'unavailable' \| 'error' }`; **503** when DB down | A *deep* check that the DB is reachable. Poll less often than the bare probe. |
| `GET /api/health` | public, **verbose only when authenticated** | Unauthed: `{ ok, service, time, db }`. Authed (valid session JWT): adds `schemaVersion`, `trackCount`, `r2: 'bound'\|'unbound'` | Operator/dashboard snapshot. The minimal unauthed shape is intentional — pentest **M-16/M-18** removed schema version, track count, and storage binding from public output to deny recon signals. |
| `GET /api/status` | public | `{ ok, ts, encoder{…}, scheduler{ lastHeartbeatAt }, lastBroadcastAt }` — degrades to nulls during partial outages | The public **status page**. Aggregates encoder + scheduler heartbeat + last broadcast. |

> Don't point an uptime monitor at `/api/health` expecting `trackCount`/`r2` — those only appear for authenticated callers. For plain "is it up", use `/api/healthz`.

---

## 2. Point an uptime monitor at `/api/healthz`

Any of Better Stack / UptimeRobot / Healthchecks.io works. Recommended config:

- **Monitor URL:** `https://sonic-bloom-web-production.up.railway.app/api/healthz`
- **Method:** `GET`
- **Expected status:** `200`
- **Expected body (optional but recommended):** contains `"ok":true`
- **Interval:** 60s (the bare probe is cheap — no DB hit)
- **Alert after:** **2 consecutive failed checks** (avoids paging on a single transient blip / cold start)

### Better Stack

1. **Monitors → Create monitor**.
2. URL above, method `GET`, expected status `200`.
3. (Optional) **Expected to contain:** `"ok":true`.
4. Check frequency 60s; "Confirm with N regions" → require 2 before alerting.
5. Attach an escalation policy (email / Slack / phone).

### UptimeRobot

1. **Add New Monitor → HTTP(s)**.
2. URL above; **Monitoring interval** 1 min (or 5 min on free tier).
3. **Advanced → Keyword** monitor type with keyword `ok` if you want body assertion.
4. Set alert contacts; UptimeRobot alerts after the configured failure count.

### Healthchecks.io

Healthchecks.io is pull/ping-oriented; for an HTTP uptime check use its "monitor a URL" feature or pair it with Better Stack/UptimeRobot for the HTTP probe and use Healthchecks.io for the **cron dead-man's switch** below (§4).

### Deep DB check (second monitor)

Add a **separate, slower** monitor for `GET /api/healthz?probe=db`:
- Interval 5 min (it runs `SELECT 1` against Postgres — don't hammer it).
- Expected status `200`; treat **503** (`db: 'unavailable' | 'error'`) as down.
- This catches "web process is up but the database is unreachable", which the bare probe won't.

---

## 3. Railway built-in deploy + crash notifications

Railway emits its own signals — turn these on so you hear about deploy/crash events without waiting for an external probe to notice:

1. Railway dashboard → **Project → Settings → Notifications** (or your account-level notification settings).
2. Enable **Deploy** notifications (success/failure) and **Crash / restart** notifications.
3. Route them to email and/or a Slack/Discord webhook.

These cover the "Railway killed/restarted the container" case directly, complementing the black-box `/api/healthz` probe.

---

## 4. Alert on **missed** pg-backup runs (not just failures)

`.github/workflows/pg-backup.yml` runs daily at **03:17 UTC**. GitHub Actions emails the repo owner when a scheduled job **fails** — but it says **nothing if the job never runs** (disabled schedule, repo inactivity pausing crons, runner outage). A dead-man's switch fixes that.

**Recommended: a success-ping from the workflow.**

1. Create a check in Healthchecks.io (or a Better Stack heartbeat) with **period = 1 day** and a grace window (e.g. 6h). It gives you a ping URL like `https://hc-ping.com/<uuid>`.
2. Store that URL as a repo secret, e.g. `BACKUP_PING_URL`.
3. Add a final step to the `backup` job that pings **only on success**, after `npm run backup:pg`:

```yaml
      - name: Ping backup heartbeat (success only)
        if: success()
        run: curl -fsS --retry 3 "${{ secrets.BACKUP_PING_URL }}" > /dev/null
```

Now if the job is skipped or never runs, the heartbeat goes silent and Healthchecks.io alerts you on the **missed** run — exactly the failure mode GitHub's own emails miss. (This is the "additional monitoring" already flagged in `docs/PG-BACKUP-SETUP.md` §Monitoring.)

> Keep GitHub's failure email on too: that path catches the *job ran but errored* case, the heartbeat catches the *job didn't run* case. You want both.

---

## 5. Optional: Sentry error alerting

A browser-side Sentry shim already exists at `src/lib/sentry-client.ts`. Today it's a **stub** — with a DSN present it logs a truncated DSN and routes `captureException` to `console`. The real `@sentry/nextjs` swap-in is a follow-up; the call surface is stable so wiring the DSN now is low-risk.

To prepare:

1. Create a Sentry project (platform: **Next.js**) and copy its **DSN**.
2. Set the public DSN env var on Railway:

   ```bash
   railway variables --service sonic-bloom-web --set 'NEXT_PUBLIC_SENTRY_DSN=<your-sentry-dsn>'
   ```

3. The client initializes lazily in the browser only — `initSentryClient({ NEXT_PUBLIC_SENTRY_DSN })` returns `null` during SSR and when no DSN is set, so an unset DSN is a safe no-op.
4. When the real `@sentry/nextjs` lands, configure alert rules in Sentry for new-issue and regression events, and route them to the same Slack channel as your uptime alerts.

> `NEXT_PUBLIC_SENTRY_DSN` is a publishable client DSN, not a secret in the credential sense — but still set it via Railway vars, not hardcoded. Never put a server-side auth token in a `NEXT_PUBLIC_*` var.

---

## 6. Recommended alert thresholds

Tune to taste, but these are sensible starting points:

| Signal | Source | Threshold | Why |
|---|---|---|---|
| `/api/healthz` down | Uptime monitor | **2 consecutive failed checks** (≈2 min at 60s interval) | One miss is usually a cold start / transient; two means a real outage. |
| `/api/healthz?probe=db` 503 | Deep monitor (5 min) | 2 consecutive | DB unreachable while web is up. |
| 5xx error rate | Railway metrics / Sentry | **> 1–2% of requests over 5 min** | Sustained server errors, not a one-off. |
| p95 latency | Railway metrics | **> ~1s sustained over 5–10 min** | Degradation before it becomes a full outage; calibrate to your real baseline. |
| Missed pg-backup | Healthchecks.io heartbeat | 1 missed daily ping (+ grace window) | Backup didn't run at all. |
| Deploy failure / crash | Railway notifications | Immediate | Container-level events. |

Route everything to **one** channel (Slack/Discord/email) first; split into escalation tiers later if volume demands it. Avoid alert fatigue — a noisy monitor gets muted, then misses the real outage.

---

## 7. Verify the wiring

```bash
# Bare liveness — expect 200 {"ok":true,"ts":...}
curl -i 'https://sonic-bloom-web-production.up.railway.app/api/healthz'

# Deep DB probe — expect 200 with "db":"connected" (or 503 if DB down)
curl -i 'https://sonic-bloom-web-production.up.railway.app/api/healthz?probe=db'

# Public health (minimal, unauthenticated)
curl -i 'https://sonic-bloom-web-production.up.railway.app/api/health'

# Public status page snapshot
curl -i 'https://sonic-bloom-web-production.up.railway.app/api/status'
```

To exercise the missed-backup alert, manually run the backup once (Actions tab → "pg-backup" → "Run workflow") and confirm the heartbeat check in Healthchecks.io flips to "up".

---

## 8. Monitoring checklist

- [ ] Uptime monitor on `/api/healthz` (60s, alert after 2 fails)
- [ ] Deep monitor on `/api/healthz?probe=db` (5 min, 503 = down)
- [ ] Railway deploy + crash notifications enabled, routed to a channel
- [ ] pg-backup workflow pings a Healthchecks.io / Better Stack heartbeat on success
- [ ] Heartbeat configured with a 1-day period + grace window (alerts on *missed* runs)
- [ ] GitHub Actions failure email still enabled (catches job-ran-but-errored)
- [ ] (Optional) `NEXT_PUBLIC_SENTRY_DSN` set on Railway; real `@sentry/nextjs` wired when approved
- [ ] 5xx-rate and p95-latency alerts configured against a measured baseline
- [ ] All alerts land in one channel; no hardcoded secrets in any monitor config
