# Railway Cutover Playbook — Wave RM-δ

**Status:** Pending — runs only after waves α, β, γ are green.

**Workrules tier:** **R0** (touches production data and DNS). Requires explicit "go" from the user before each numbered step is executed.

**Last updated:** 2026-05-16

---

## 0. Pre-flight (must all be true)

Before starting δ:

- [ ] `npm test` is green (1437+ main tests passing)
- [ ] `npm run test:migrations` is green (29/29)
- [ ] `npm run lint` is clean
- [ ] `npm run build` succeeds
- [ ] All 47 Cloudflare endpoints have parallel Next.js routes (`functions/api/<path>.ts` ↔ `src/app/api/<path>/route.ts`)
- [ ] Wave RM-γ landed — `src/server/storage.ts` is a working S3-compatible R2 client
- [ ] User has provided the four δ-blocking secrets (§3 of RAILWAY-KICKOFF.md):
  - `DATABASE_URL` (Railway Postgres)
  - Railway production domain
  - R2 S3-compatible credentials (`STORAGE_ENDPOINT_URL`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`; `STORAGE_REGION` optional)
  - `AUTH_JWT_SECRET` (copy of the existing Cloudflare value)

If any check fails, **stop**. δ is not the wave that fixes earlier breakage.

---

## 1. Provision Railway Postgres (R0)

User-driven steps; Claude provides scripts but does **not** execute them.

1. In Railway dashboard → New Service → PostgreSQL 15.
2. Copy the public `DATABASE_URL` from Connect tab. Save into:
   - Local: `.env.local` (gitignored)
   - Railway service env: `DATABASE_URL` is auto-injected when the PG service is linked
3. Apply the Drizzle migrations against the new Railway PG:
   ```bash
   DATABASE_URL='<railway-url>' npm run db:migrate
   ```
   This is **R1** by itself — the DB has no data yet. Verify by connecting and running `\dt` (expect 21 tables).

---

## 2. Generate the D1 → Postgres sync script (R1)

We need a one-shot dump-and-replay script. It runs **once**, against a paused production write window if possible, otherwise during the 1-week dual-stack monitoring.

Script: `scripts/migrate-d1-to-pg.mjs`

Behavior:
- For each of the 21 tables, in FK-dependency order:
  - `wrangler d1 execute sonic-bloom-db --remote --json --command "SELECT * FROM <table>"` → JSON
  - Validate row count
  - `INSERT INTO <table> (...) VALUES (...) ON CONFLICT (id) DO UPDATE SET ...` against PG using `pg`
- Emit a per-table report: D1 count, PG count, delta
- Bail loudly on any row that fails to round-trip (CHECK constraint mismatch, etc.)

Dependency order (avoid FK violations on insert):
```
1. organizations
2. stations
3. auth_users
4. station_members
5. artists
6. albums
7. tracks
8. playlists
9. playlist_tracks
10. media_objects
11. categories
12. radio_tracks
13. clocks
14. clock_slots
15. schedule_assignments
16. voice_tracks
17. play_log
18. audit_log
19. ai_usage
20. comments
21. presence_sessions
```

**Tested locally first** against a Docker PG before pointing at Railway.

---

## 3. Deploy Next.js to Railway (R0)

User-driven:

1. Push a `railway` branch with the migration artifacts:
   - `Dockerfile` (Next.js standalone build)
   - `railway.json` (build + start commands)
   - All `src/app/api/**/route.ts` files
2. In Railway, create a new web service → connect to the `urban-radio` repo on the `railway` branch.
3. Set service env vars:
   - `DATABASE_URL` — auto-injected if PG service is linked
   - `AUTH_JWT_SECRET` — same value as the Cloudflare worker
   - `STORAGE_ENDPOINT_URL` — `https://<account-id>.r2.cloudflarestorage.com`
   - `STORAGE_ACCESS_KEY_ID`
   - `STORAGE_SECRET_ACCESS_KEY`
   - `STORAGE_BUCKET` — `sonic-bloom-media`
   - `NEXT_PUBLIC_*` envs as on Cloudflare
4. Deploy. Verify:
   - `https://<railway-domain>/api/healthz` returns 200
   - `https://<railway-domain>/api/healthz?probe=db` returns 200 (PG connectivity)
   - `https://<railway-domain>/api/auth/me` does not report `authNotConfigured: true` (i.e. `AUTH_JWT_SECRET` is set): 401 `{ authenticated: false }` when logged out, 200 `{ authenticated: true, user }` once logged in
5. Do **not** flip DNS yet. The Railway service is alive but receives no production traffic.

---

## 4. One-shot data sync (R0)

User decides the window. Two options:

### Option 4a — Cold sync (preferred)

1. Announce 5-minute maintenance window on the status page.
2. Pause all Cloudflare write endpoints by setting `WRITE_DISABLED=true` env on Pages → triggers an early 503 in `_middleware.ts` for non-GET methods. (Requires a small Pages addition; ship as part of γ.)
3. Run `node scripts/migrate-d1-to-pg.mjs --dry-run` — review report. Then `--apply`.
4. Confirm row counts match for all 21 tables.
5. Lift `WRITE_DISABLED`. Cloudflare resumes serving — but writes from this moment forward go to D1 only.

### Option 4b — Live sync with dual-write

1. Don't pause Cloudflare.
2. Add mirror-write logic to each Cloudflare endpoint that pushes writes to PG over the network. (This is a non-trivial code change — separate sub-task.)
3. Run the same sync script. The window of inconsistency is whatever takes for mirror-writes to catch up.

**Recommend 4a** for first cutover; 4b is harder to verify.

---

## 5. DNS flip (R0)

1. In Cloudflare DNS, change `sonicbloom.<domain>` from the Pages deployment to the Railway service.
2. TTL was set to 60s long ago (verify). Propagation under 5 minutes.
3. Monitor `https://sonicbloom.<domain>/api/healthz` from a clean network — should hit Railway now.

---

## 6. Hot standby week (R1)

Cloudflare Pages keeps running for 7 days. Used only as instant rollback target.

Daily checks during this week:

- [ ] Railway PG row counts match Cloudflare D1 counts via a check script
- [ ] No 5xx spikes in Railway logs
- [ ] No auth issues (cookies should keep working — same `AUTH_JWT_SECRET`)
- [ ] No R2 errors (same bucket, just different access path)

If any check fails: **flip DNS back to Cloudflare**. The D1 still has all the data (it stopped receiving writes at §4 but it still serves reads). After fixing, redo §4–§5.

---

## 7. Archive Cloudflare (R1)

After 7 clean days:

1. Export D1 to R2: `npm run backup` (the existing `scripts/backup-d1-to-r2.mjs`).
2. Archive the R2 export as `d1-archive-<date>.tar.gz` in a long-retention bucket.
3. Delete the Cloudflare Pages project deployment (keeps the Pages project record but stops invocations).
4. Update the kickoff doc: change "Active" status to "Complete".

---

## 8. Rollback matrix

| State | If something breaks | Recovery |
|---|---|---|
| Pre-§4 (Railway up, no sync) | Anything | Just shut down Railway. Cloudflare unaffected. |
| Mid-§4 sync | Sync script fails | Sync is idempotent (ON CONFLICT DO UPDATE) — fix the issue, re-run. |
| Post-§4, pre-§5 | New PG-side writes via Railway? | None possible — DNS still on Cloudflare. |
| Post-§5 DNS flip | Railway down, PG corrupt, anything | DNS flip back to Cloudflare. D1 is the source of truth from §4 onward. Drop the Railway PG, redo from §1. |
| Hot standby week | Issue spotted | DNS flip back. See above. |
| After §7 archive | Issue spotted | Restore D1 from the R2 archive (procedure in `scripts/backup-d1-to-r2.mjs`'s docstring). |

---

## 9. Workrules sign-off

Each numbered section above is a separate R0 / R1 decision. The agent **must not** execute steps 1, 3, 4, 5, or 7 without an explicit "go" from the user for that specific step.

Steps 2, 6, and 8 are documentation / monitoring and can be prepared at any time.
