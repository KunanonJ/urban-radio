# Railway Hobby Migration Plan

**Audience:** the human + AI pair making the call.

**Last updated:** 2026-05-15

**Workrules tier:** Plan is R2 (doc). Execution is **R1 minimum, R0 if production data moves**.

---

## 0. Honest dissent

Per workrules §3.3 — surface concerns before any work.

| Concern | Detail |
|---|---|
| Third backend pivot | Project initially shipped under Lovable, rejected Firebase (`docs/rejected/PRD-NEXT-FIREBASE.md`), committed to Cloudflare. Railway is pivot #3. Each pivot kills 1–2 weeks of work. |
| Cost trajectory | Railway Hobby = **$5/mo credit**. The current Cloudflare bill is effectively $0 because the app is on free tiers (Pages + D1 free quota + R2 10 GB free). Hobby plan covers a Next.js dyno + Postgres but is tight; streaming (AzuraCast) would blow past it on its own. |
| Runtime incompatibility | Pages Functions run on V8 isolates with the Workers runtime API (no `node:` modules, no filesystem). Railway runs full Node.js — same code mostly works, but **D1 bindings** (`env.DB`), **R2 bindings** (`env.MEDIA_BUCKET`), and Wrangler-specific glue all break. |
| Schema rewrite | 8 D1 migrations use SQLite syntax. Postgres uses different DDL for: identity types, UNIQUE-on-CONFLICT, datetime defaults, JSON columns, CHECK constraints. A migration tool (Drizzle Kit, Prisma migrate) is needed; existing migrations need rewriting. |
| Cold-start vs always-on | Pages Functions cold-start in ~10 ms. Railway dynos are always-on (or paused). Free-plan-on-Railway has different latency characteristics; users may notice. |
| What I'm not seeing | Why Railway? If it's because Cloudflare is hard to deploy, the answer is to fix the deploy (`wrangler pages deploy` works). If it's because you want a single dashboard for app + DB + observability, Railway delivers that. If it's because someone gave you a Railway gift card, the migration cost outweighs the gift. |

**Recommendation: don't full-migrate.** The cheapest path is **Option C below** — keep Cloudflare for the app + data, use Railway only for the streaming engine that Phase 3 needs anyway.

But if you want the full migration, the plan is here.

---

## 1. Three migration shapes — pick one before any code

### Option A — Full migration to Railway (highest effort, ~2–3 weeks)

Everything moves: Next.js → Railway Web service, D1 → Railway Postgres, R2 → S3-compatible (Backblaze B2 or Cloudflare R2 as external), Pages Functions → Next.js API Routes (in `src/app/api/`).

**Pros:**
- Single dashboard for app + DB + observability
- Real Node.js means `node:` modules work (better-sqlite3, sharp, ffmpeg-static)
- Easy to add Redis, Postgres extensions, cron jobs
- Native Stripe webhook handling without isolate quirks

**Cons:**
- Rewrites every Pages Function as a Next API Route
- Rewrites every D1 migration to Postgres
- Loses Cloudflare's edge caching + DDoS shield (Railway has neither at $5/mo)
- $5/mo credit is tight — dyno + Postgres alone is ~$5/mo at minimum
- All E2E + integration tests need re-running against the new stack

**Effort:** 2–3 focused weeks of agent work, plus operator verification time.

### Option B — Hybrid: Next.js on Railway, data on Cloudflare (medium effort, ~1 week)

App moves to Railway. D1 + R2 stay on Cloudflare, accessed via Cloudflare's HTTP APIs (D1 has a REST API; R2 has S3-compatible).

**Pros:**
- App benefits from Railway's logging + observability dashboard
- Keeps D1/R2 data + migrations intact
- Reuses the existing Pages Functions logic — just wrap each one as a Next API Route that calls the Cloudflare API

**Cons:**
- Adds a network hop from Railway → Cloudflare for every DB/storage call (latency tax)
- Two clouds = two bills + two dashboards + two failure modes
- Cloudflare's D1 HTTP API has lower throughput than the binding (~50 QPS vs ~1000 QPS for the binding)
- Still rewrites every endpoint shape

**Effort:** ~1 week.

### Option C — Surgical: keep Cloudflare, use Railway only for AzuraCast (lowest effort, ~2 days) ⭐ recommended

Phase 3's R0 wall is "real Icecast/Shoutcast streaming" which Cloudflare cannot do. The plan always assumed an external sidecar. Railway is a great fit for that one container.

**Pros:**
- Zero changes to the Sonic Bloom app
- Closes the Phase 3 R0 wall using your existing Railway Hobby budget
- Cloudflare bill stays $0; Railway Hobby covers the AzuraCast container (~$3–5/mo)
- Reversible: turn off the Railway service, switch back to stub adapter
- Already documented in [stream-control.ts](../functions/_lib/stream-control.ts) — one-line factory swap from `StubStreamControl` to `AzuraCastAdapter(env.STREAM_CONTROL_URL, env.STREAM_CONTROL_KEY)`

**Cons:**
- Doesn't unify the dashboards (Cloudflare + Railway still separate)
- AzuraCast on Railway needs persistent volume; Hobby plan volumes are 5 GB max — fine for one station's metadata, but track audio still wants R2

**Effort:** ~2 days. **This is what I recommend.**

---

## 2. If you pick Option C — concrete steps

This is the surgical path. Closes Phase 3 R0. Doesn't touch the app.

### 2.1 Railway side (manual, ~1 hour)

1. **Provision an AzuraCast service**: AzuraCast publishes an official Docker image at `ghcr.io/azuracast/azuracast:latest`. On Railway: New Project → Empty Service → Source = Docker Image → paste the URL.
2. **Add a Railway Volume** mounted at `/var/azuracast` (where AzuraCast persists config + uploaded media). Hobby gives 5 GB.
3. **Set the public domain**: Railway → Service → Settings → Generate Domain. Get a `*.up.railway.app` URL.
4. **Configure env vars**:
   - `APPLICATION_ENV=production`
   - `MYSQL_HOST=…` if you want a separate Postgres/MySQL add-on for AzuraCast's internal DB; else AzuraCast runs SQLite internally on its own volume
5. **Boot + complete the AzuraCast setup wizard** at the public URL: admin user, station name, mount point name (`/stream`), bitrate, format.
6. **Generate an AzuraCast API key**: AzuraCast UI → Settings → API Keys → create one with `station_manage_media` + `station_manage_broadcasts` scopes.

### 2.2 Sonic Bloom side (~1 hour, R1)

1. **Add env vars** in Cloudflare Pages dashboard:
   ```
   STREAM_CONTROL_URL=https://<your-azuracast>.up.railway.app
   STREAM_CONTROL_KEY=<the API key>
   ```
   Same vars locally in `.dev.vars`.

2. **Write the adapter** in `functions/_lib/stream-control.ts` — add an `AzuraCastAdapter` class that implements the existing `StreamControlAdapter` interface. The HTTP calls map to:
   - `start(stationId)` → `POST /api/station/{az_station_id}/automation/start`
   - `stop(stationId)` → `POST /api/station/{az_station_id}/automation/stop`
   - `updateMetadata(stationId, meta)` → `POST /api/station/{az_station_id}/queue/manage` with the title in `request_data.title`
   - `status(stationId)` → `GET /api/station/{az_station_id}` → map response to `StreamStatus`
   
   AzuraCast's station id (the integer it assigns) is different from your Sonic Bloom station slug. Add a `azuracast_station_id` column to the `stations` table via a new migration `0009_azuracast_station_id.sql`, or hard-code the mapping per env var.

3. **Flip the factory** — change `getStreamControl()` to return `new AzuraCastAdapter(env.STREAM_CONTROL_URL, env.STREAM_CONTROL_KEY)` when both env vars are set.

4. **Tests**: rewrite the stream-control test to assert the HTTP calls hit the right AzuraCast paths; keep the StubStreamControl as the fallback.

5. **Smoke test**: locally, `npm run dev:share`, visit `/app/live-studio`, click "Go on air" — verify the AzuraCast UI shows "live" status and your station URL plays the configured fallback music.

### 2.3 Voice tracks / uploaded audio (optional, Phase 3.1)

AzuraCast wants the audio files on its own volume to play them. Two patterns:

- **Push pattern**: when an operator uploads to Sonic Bloom (`POST /api/upload` → R2), also POST the same bytes to AzuraCast's `/api/station/{n}/files` endpoint. Adds latency to upload; safest.
- **Pull pattern**: when AzuraCast asks for the next track, the Sonic Bloom playout engine signs a temporary R2 URL and POSTs it as a "remote" station file. Cheaper storage; more moving parts.

Defer this to a follow-up. v1 of streaming can use AzuraCast's own media library (manually uploaded via the AzuraCast UI) just to prove the stream works.

### 2.4 Rollback for Option C

- Remove the `STREAM_CONTROL_URL` env var in Cloudflare Pages → factory falls back to `StubStreamControl` automatically (already coded that way).
- Tear down the Railway service.

---

## 3. If you pick Option A — concrete steps

Full migration. Multi-week. Don't take this lightly.

### 3.1 Decision matrix to lock first

| # | Decision | Recommendation |
|---|---|---|
| RM-1 | Database | **Railway Postgres** (1 GB free with Hobby) over MySQL — Postgres has better JSON + window functions + extensions |
| RM-2 | ORM / query builder | **Drizzle ORM** — pure SQL, no Prisma's binary engine on Railway, matches the current pure-builder pattern from `functions/_lib/*-queries.ts` |
| RM-3 | Object storage | **Cloudflare R2 as external S3-compatible** (keeps the storage migration off the critical path) OR **Backblaze B2** ($0.005/GB/mo) |
| RM-4 | API surface | Move from `functions/api/*` to `src/app/api/*` (Next.js Route Handlers). Same code, different ambient request/env shape. |
| RM-5 | Auth | Keep HS256 JWT in `sb_session` cookie — works identically on Next.js |
| RM-6 | Migrations runner | Drizzle's `migrate` package, run on Railway via a post-deploy hook |
| RM-7 | E2E tests | Re-point Playwright at the Railway preview URL; existing tests should mostly pass |

### 3.2 Phased rewrite — 4 phases

**Phase RM-1 — Database (R1, ~3 days)**
1. Provision Railway Postgres
2. Set up Drizzle + write a `drizzle.config.ts`
3. Translate each of the 8 D1 migrations to Postgres-flavored Drizzle migrations:
   - SQLite `TEXT` → Postgres `TEXT` (no change)
   - SQLite `INTEGER` for booleans → Postgres `BOOLEAN`
   - SQLite `datetime('now')` → Postgres `NOW()` or `CURRENT_TIMESTAMP`
   - SQLite `INSERT OR IGNORE` → Postgres `INSERT … ON CONFLICT DO NOTHING`
   - SQLite `INSERT … ON CONFLICT (col) DO UPDATE` → Postgres syntax differs slightly
   - SQLite CHECK constraints work identically
   - SQLite create-copy-rename pattern (used in 0006) becomes Postgres `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT`
4. Rewrite the migration test harness to use `better-sqlite3` → Postgres equivalent (`pg-mem` or a real ephemeral DB)
5. Verify by inserting/selecting via psql

**Phase RM-2 — Storage (R1, ~1 day)**
1. Set up Cloudflare R2 as an external S3-compatible bucket (or Backblaze B2)
2. Replace every `env.MEDIA_BUCKET.put(...)` with `@aws-sdk/client-s3` `PutObjectCommand`
3. Replace every `env.MEDIA_BUCKET.get(...)` with `GetObjectCommand`
4. Test upload + delete + dedup paths
5. Migrate existing R2 objects via a one-time rclone copy

**Phase RM-3 — API surface (R1, ~5 days)**
1. For each `functions/api/<path>.ts`, create `src/app/api/<path>/route.ts`
2. Replace `requireStation(env, request)` with a Next-compatible version that reads from `cookies()` and queries Postgres
3. Replace `env.DB.prepare(sql).bind(...).all()` with Drizzle queries
4. Replace `env.MEDIA_BUCKET.put` with S3 SDK
5. Test each endpoint via vitest + Playwright
6. Once green, **delete** `functions/api/*` and `wrangler.toml`'s D1/R2 bindings

**Phase RM-4 — Deploy + verify (R1, ~2 days)**
1. Connect Railway to the GitHub repo
2. Configure build: `npm run build`, start: `npm start`
3. Wire env vars: `DATABASE_URL`, `S3_*`, `AUTH_JWT_SECRET`, `NEXT_PUBLIC_*`
4. Run migrations on deploy via a `release` script
5. Smoke test against the Railway URL
6. Update DNS (if you have a custom domain)
7. **Don't** delete the Cloudflare project for 1 week — that's your rollback

### 3.3 Rollback for Option A

For 1 week after cutover, keep:
- Cloudflare Pages project up (just stop accepting traffic via DNS)
- Last D1 export saved to R2 as a `.sql` dump
- Last R2 inventory saved
- `wrangler.toml` in a `git tag` so you can `git checkout` the pre-migration state

After 1 week of clean Railway operation, archive the Cloudflare resources.

---

## 4. If you pick Option B — concrete steps

Hybrid. App on Railway, data on Cloudflare. ~1 week.

### 4.1 Setup

1. Generate a **Cloudflare D1 API token** with `D1:Edit` scope. Add as `CF_D1_TOKEN` to Railway.
2. Generate **R2 S3 credentials** in Cloudflare dashboard. Add `CF_R2_KEY` + `CF_R2_SECRET` + `CF_R2_ENDPOINT` to Railway.
3. Wrap each Pages Function as a thin Next API route that proxies via:
   - `fetch('https://api.cloudflare.com/client/v4/accounts/<acc>/d1/database/<db>/query', { method: 'POST', body: JSON.stringify({ sql, params }) })` for D1
   - `@aws-sdk/client-s3` against the R2 S3 endpoint
4. Repackage `requireStation` + `audit-log` as Next-compatible helpers that hit the same D1 HTTP API

### 4.2 Rollback for Option B

- Revert the DNS pointing at Railway → Cloudflare Pages
- The data is still on Cloudflare; nothing to migrate back

---

## 5. Cost projections

| Setup | Monthly cost (small station, 100 listeners) |
|---|---|
| Current: all Cloudflare free tiers | **$0** |
| Option C: Cloudflare + Railway AzuraCast | **$3–5/mo Railway** (covered by Hobby credit) |
| Option B: Cloudflare data + Railway app | **$5/mo Railway** (covered) + **$0 Cloudflare** |
| Option A: full Railway | **$5–10/mo Railway** (mostly covered; over if Postgres exceeds 1 GB or you add Redis) + storage cost separately |

The cost case for Option A is weak — you're paying $5/mo for what's currently free.

---

## 6. Decision needed (pick one, then I write the kickoff brief)

| Pick | Effort | Risk | Cost change |
|---|---|---|---|
| **C** (surgical — AzuraCast only) ⭐ recommended | 2 days | Low (just stream output) | +$3–5/mo |
| **B** (hybrid — Next on Railway, data on CF) | 1 week | Medium (network hop tax) | +$5/mo |
| **A** (full migrate) | 2–3 weeks | High (rewrites everything) | +$5/mo |
| **None** — stay on Cloudflare, scrap Railway | 0 | None | $0 |

---

## 7. What I'd do if I were you

Pick **C**. You wanted to share the app via Railway — that's not what Railway is for. Use Cloudflare Pages (`npm run deploy` produces a `*.pages.dev` URL — free, permanent, edge-cached) for the app, and Railway Hobby for the AzuraCast container that finally closes the Phase 3 R0 wall. The total monthly cost stays inside the $5 Railway credit and Cloudflare's free tier, and you get real broadcasting capability.

Tell me which option, and I'll write a focused kickoff brief (the equivalent of `PHASE-1-KICKOFF.md`) plus the agent prompts to execute it.
