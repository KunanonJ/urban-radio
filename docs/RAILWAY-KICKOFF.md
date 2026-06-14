# Railway Migration — Option A Kickoff

**Status:** Codebase migrated; deploy live, runtime cutover still pending. The Railway service (`github.com/KunanonJ/urban-radio`) builds and deploys the Docker image via Railway's native GitHub integration and the `/api/healthz` liveness probe is green — but provisioning the production Postgres, setting env vars, applying migrations, seeding the admin, and any DNS flip / D1 backfill are **not yet done** (tracked in issue #14; see [RAILWAY-CUTOVER-PLAYBOOK.md](./RAILWAY-CUTOVER-PLAYBOOK.md)). This doc is the original kickoff plan, kept as a historical record; for current commands and conventions see [AGENTS.md](../AGENTS.md).

**Last updated:** 2026-06-14 (code migrated + deploying; runtime cutover pending)

**Workrules tier:** Plan is R2 (this doc). Each phase below is R1 minimum; production cutover is R0.

## Live progress

| Wave | Status | Tests added | Notes |
|---|---|---|---|
| RM-α schema | ✅ done | +19 | 21 tables mirrored (kickoff doc undercounted; `playlist_tracks` and `voice_tracks` were missed) |
| RM-α client | ✅ done | +8 | `getDb()` factory, docker-compose, npm scripts |
| RM-β0 foundation | ✅ done | +22 | auth helpers + middleware + response helpers + pg-mem test harness |
| RM-β1 auth + health template | ✅ done | +18 | 6 routes: login, logout, me, health, healthz, status |
| RM-β audit-log helper | ✅ done | +3 | `writeAuditLog(db, entry)` — Drizzle port, swallows failures |
| RM-β2 catalog | ✅ done | +24 | 8 routes + catalog-map + catalog-queries (Drizzle keyset cursors) |
| RM-β3 stream + upload | ✅ done | +55 | 6 routes + `StorageAdapter` contract for γ + multipart upload pipeline |
| RM-β4 clocks + schedule | ✅ done | +43 | 6 routes + park-then-land reorder + `isUniqueViolation()` for 409 mapping |
| RM-β5 VT + comments + presence | ✅ done | +33 | 6 routes + native `onConflictDoUpdate` for presence heartbeat |
| RM-β6 reports + audit + play-log | ✅ done | +31 | 7 routes + CSV export of audit log + UTC-day aggregations via `substring(played_at, ...)` |
| RM-β7 AI | ✅ done | +26 | 5 routes reusing `@/lib/ai` cost-guard verbatim (Drizzle SUM needed `.as('total')` alias under pg-proxy) |
| RM-β8 royalty + stations + webhooks | ✅ done | +27 | 3 routes + ASCAP/BMI/SoundExchange CSV with UTF-8 BOM + Stripe HMAC verify |
| RM-γ storage | ✅ done | +9 | `S3Storage` against R2 via `@aws-sdk/client-s3` + presigner; auto-selected by `getStorage()` when `STORAGE_*` env is set; lazy-required so the SDK stays out of the bundle for unconfigured envs |
| RM-γ Next 15 build fix | ✅ done | — | `scripts/split-route-handlers.mjs` ran across all 47 routes; each `route.ts` now re-exports verbs from a sibling `route-impl.ts` (Next 15 strict types reject non-verb route exports) |
| RM-γ middleware fix | ✅ done | — | Middleware pinned to `runtime: 'nodejs'` because `jose`'s `CompressionStream` isn't Edge-supported |
| RM-δ §2 deploy artifacts | ✅ done | +17 | `Dockerfile` (Node 22 alpine, standalone), `.dockerignore`, `railway.json`, `next.config.ts` `output: 'standalone'`, `scripts/migrate-d1-to-pg.mjs` (D1→PG one-shot sync, dry-run + apply modes, 17 unit tests), `db:sync-from-d1` npm script |
| RM-δ §1+§3 cutover | 🟡 partial (R0) | — | The Docker image deploys via Railway's **native GitHub integration** (auto-deploys on push to `main`; `github.com/KunanonJ/urban-radio`) and the `/api/healthz` liveness probe is green. **Still pending:** provision the production Postgres, set env vars (`DATABASE_URL`, `AUTH_JWT_SECRET`, `STORAGE_*`, `STRIPE_WEBHOOK_SECRET`), apply `npm run db:migrate`, seed the admin (`scripts/seed-railway-admin.mjs`), and any DNS flip / D1 backfill (`npm run db:sync-from-d1`). Tracked in issue #14. See `docs/RAILWAY-CUTOVER-PLAYBOOK.md` |

**Total tests:** 1370 baseline + 318 net new = **1688 main tests** + 29 migration. Full suite passes; one pre-existing JSDOM worker OOM crashes 6 tests in an unrelated UI-heavy file (independent of this migration).

**Build:** `npm run build` is green. All 47 Next.js API routes appear in the route table; Wave γ's split keeps each `route.ts` minimal so Next 15's strict route type-check accepts them.

**TypeScript:** `npx tsc --noEmit` is clean except for one pre-existing unused `@ts-expect-error` directive in `src/lib/sentry-client.test.ts:68` (unrelated to migration).

**Route coverage:** all 47 Cloudflare endpoints in `functions/api/**` now have parallel Next.js Route Handlers under `src/app/api/**`. Cloudflare side untouched throughout β + γ. The two stacks can be deployed side by side; cutover (DNS flip) is the only remaining R0 step.

## Aggregate helpers ported to `src/server/`

- `auth/{session-jwt,require-station,require-session,password}.ts` — JWT + station gate + middleware gate + PBKDF2
- `api-response.ts` — `jsonOk`, `jsonError`, `methodNotAllowed`
- `audit-log.ts` — best-effort audit row writer
- `stream-control.ts` — encoder stub (parity with Cloudflare)
- `storage.ts` — `StorageAdapter` contract (γ will add the S3 impl)
- `upload-helpers.ts` — multipart parsing + SHA-256 dedupe
- `catalog-map.ts`, `catalog-queries.ts` — radio_tracks JSON mappers + Drizzle list/detail builders
- `clock-queries.ts`, `schedule-queries.ts`, `rrule-validation.ts` — clocks + schedule CRUD + rrule normalizer
- `voice-track-queries.ts`, `comment-queries.ts`, `presence-queries.ts` — VT + comments + presence CRUD
- `queries/report-queries.ts`, `queries/audit-log-queries.ts`, `queries/play-log-queries.ts` — analytics + audit list + play-log
- `ai/bridge.ts`, `ai/providers.ts` — cost-guarded AI runner + server-side provider factory
- `royalty/{csv,index,ascap,bmi,soundexchange}.ts` — CSV emitters with UTF-8 BOM + CRLF parity
- `stripe-verify.ts` — constant-time HMAC verifier
- `station-queries.ts` — station/me envelope builder
- `test-utils/db.ts` — pg-mem-backed Drizzle harness used by all `__tests__/routes-betaN.test.ts`

---

## 1. State of the codebase before migration

| Check | Status |
|---|---|
| Vitest main | **1370 / 1370 passing** |
| Vitest migration | **29 / 29 passing** |
| Lint | clean |
| Build | green, 31 static pages |
| Backend runtime | Cloudflare Pages Functions (V8 isolates) |
| Database | Cloudflare D1 (SQLite-compatible), 16 tables, 8 migrations |
| Storage | Cloudflare R2 |
| Auth | HS256 JWT in `sb_session` cookie |

This is the **rollback target**. Any time the migration breaks, point DNS back here and the 1370 tests still pass.

---

## 2. Goal

Migrate Sonic Bloom's runtime from Cloudflare Pages Functions to **Railway** (Node.js dyno + Postgres + S3-compatible storage), without breaking the live app, while preserving all 1370 tests and 47 API endpoints.

**Non-goal:** rewriting features. Behavior must be identical post-migration.

---

## 3. Strategy: strangler-fig (incremental, reversible)

Big-bang rewrites fail. We do this in 4 reversible waves, each gated on green tests:

### Wave RM-α — Data layer (parallel, no production impact) ⬅ THIS SESSION
- Install Drizzle ORM + `pg` driver + test deps
- Write Drizzle schema mirroring the 16 D1 tables (one TS file, ~600 lines)
- Generate Drizzle Postgres migrations matching the existing D1 SQL (8 → 9 files)
- Build a tiny `db-client` factory that returns Drizzle for Postgres OR `env.DB` for D1
- Write unit tests against pg-mem (in-memory Postgres) — proves the schema works without a real Railway connection
- **R1**, but contained: new files only, no existing code touched

### Wave RM-β — Endpoint dual-write (parallel, no production impact)
- For each of the 47 endpoints in `functions/api/*`, write a parallel Next.js Route Handler at `src/app/api/<same-path>/route.ts`
- Both stacks run; clients still hit Cloudflare. Postgres receives **mirrored writes** so it stays in sync
- Verify per endpoint via vitest + Playwright
- **R1**, fully reversible (remove the Next routes)

### Wave RM-γ — Storage (parallel)
- Add `@aws-sdk/client-s3` wrappers in `src/server/storage.ts` against Cloudflare R2 (R2 has an S3-compatible API; same bucket, different access path)
- Tests pass against a localstack instance via Testcontainers
- `functions/api/upload.ts` keeps writing to R2 via Workers binding; new Next route writes via S3 SDK. Both land in the same bucket. **No data migration needed.**
- **R1**

### Wave RM-δ — Cutover (R0 — explicit user approval required)
- Provision Railway Postgres production instance
- Run a one-shot data sync from D1 → Postgres (script in `scripts/migrate-d1-to-pg.mjs`)
- Deploy the Next.js app to Railway
- Flip DNS from Cloudflare Pages to Railway
- Monitor for 1 week with the Cloudflare deployment still running as a hot standby
- After 1 clean week, archive the Cloudflare project
- **R0** — touches production data. Requires explicit "go" before execution.

---

## 4. Decisions locked

| # | Decision | Locked answer |
|---|---|---|
| RM-1 | Database | Railway Postgres 15+ |
| RM-2 | ORM | **Drizzle** (lighter than Prisma, no binary engine, fits the project's existing pure-builder pattern from `functions/_lib/*-queries.ts`) |
| RM-3 | Driver | `pg` (node-postgres) for production; pg-mem for in-memory tests |
| RM-4 | Migration tool | `drizzle-kit` (`drizzle-kit generate` + `drizzle-kit migrate`) |
| RM-5 | Object storage | Cloudflare R2 via S3-compatible API (no data migration), with fallback to Backblaze B2 if R2 becomes inconvenient |
| RM-6 | API surface | Next.js Route Handlers (`src/app/api/<path>/route.ts`), one per existing Pages Function |
| RM-7 | Auth | Same HS256 cookie; helpers move from `functions/_lib/require-station.ts` to `src/server/auth/require-station.ts` |
| RM-8 | Local Postgres for dev | Docker Compose with `postgres:15` |
| RM-9 | Cutover style | Strangler-fig + 1-week dual-stack window. No big-bang |
| RM-10 | Rollback gate | Any wave that fails tests reverts itself; full rollback = DNS flip back to Cloudflare |

---

## 5. Decisions still needed (block Wave RM-δ only)

| # | Need | Why |
|---|---|---|
| RM-D1 | Railway Postgres `DATABASE_URL` | Required only at the cutover wave; preparatory work uses local Postgres |
| RM-D2 | Railway production domain | DNS flip happens at cutover |
| RM-D3 | R2 S3-compatible credentials | Railway needs to read/write R2 over the public API. Generate via Cloudflare dashboard → R2 → "Manage API tokens" |
| RM-D4 | `AUTH_JWT_SECRET` for Railway env | Copy the existing secret so existing sessions stay valid through cutover |

None of these block this session. Waves α / β / γ proceed without them.

---

## 6. Files this migration adds

```
docs/RAILWAY-KICKOFF.md          ← this file
docker-compose.dev.yml            ← local Postgres for dev/test
drizzle.config.ts                 ← drizzle-kit config
src/db/schema.ts                  ← Drizzle table definitions (mirrors D1)
src/db/schema.test.ts             ← schema sanity tests
src/db/client.ts                  ← drizzle client factory
src/db/client.test.ts
src/db/migrations/0000_init.sql   ← drizzle-kit-generated Postgres SQL
src/db/migrations/...             ← one per D1 migration
src/server/auth/require-station.ts ← Next-compatible auth gate
src/server/auth/require-station.test.ts
src/server/storage.ts             ← S3 SDK wrapper around R2
src/server/storage.test.ts
src/app/api/<paths>/route.ts      ← 47 Next route handlers (Wave β)
scripts/migrate-d1-to-pg.mjs      ← one-shot data sync (Wave δ)
```

Existing files in `functions/`, `migrations/`, and `src/lib/` stay untouched throughout waves α/β/γ.

---

## 7. Test trajectory

| Phase | Tests (main + migration) |
|---|---|
| Pre-migration | 1399 |
| End RM-α (schema + db client) | ~1430 |
| End RM-β (47 dual-write routes) | ~1700 |
| End RM-γ (storage SDK) | ~1730 |
| End RM-δ (cutover) | 1730+ (no test change; just deploy verification) |

---

## 8. Rollback plans per wave

| Wave | Rollback |
|---|---|
| α | `git checkout HEAD~1` on the schema files; `npm uninstall drizzle-orm drizzle-kit pg pg-mem`. Existing app unaffected. |
| β | Delete `src/app/api/<paths>/route.ts`. Cloudflare Pages Functions keep serving as before. |
| γ | Revert `src/server/storage.ts` usage. R2 binding in Pages Functions still works. |
| δ | Flip DNS back to Cloudflare Pages. Postgres keeps the sync data as a frozen backup. Stop the Railway service. |

After 1 week of clean Railway operation, archive the Cloudflare project (keep the D1 export as a frozen tar.gz on R2).

---

## 9. This session's plan (Wave RM-α only)

1. Install deps: `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`, `pg-mem`, optional `dotenv` for local config
2. Author `drizzle.config.ts`
3. Add `docker-compose.dev.yml` for a local Postgres
4. Write `src/db/schema.ts` mirroring all 16 D1 tables — this is the bulk of the work
5. Run `drizzle-kit generate` to produce `src/db/migrations/0000_*.sql`
6. Verify the generated SQL matches the intent
7. Write `src/db/client.ts` — pure Drizzle factory
8. Write `src/db/schema.test.ts` against pg-mem
9. Update `package.json` scripts: `db:gen`, `db:migrate`, `db:studio`
10. Re-run full vitest — must stay at 1370+ (additive; nothing existing changes)

**Exit criteria for the session:** Drizzle schema compiles, `drizzle-kit generate` produces valid SQL, pg-mem tests pass against the new schema, full suite stays green.

**Next session** will start Wave RM-β with parallel agents writing the 47 Next Route Handlers.

---

## 10. What this session does NOT do

- Touch existing `functions/api/*` files — they keep serving traffic
- Touch existing `migrations/*.sql` — they keep being the source of truth for D1
- Hit Railway — Wave RM-α runs entirely locally
- Change deployment — `npm run deploy` still ships to Cloudflare Pages

This is preparation. The user-facing app is unchanged. Risk-free in the strangler-fig pattern.

---

## 11. Local dev setup (Wave RM-α onwards)

Bring up a local Postgres in Docker, generate + apply Drizzle migrations, then
open Drizzle Studio to inspect rows. Connection defaults are baked into
`docker-compose.dev.yml` and mirrored in `.env.example`.

```bash
# Start local Postgres (detached). Volume persists across `db:down`.
npm run db:up

# Generate SQL migrations from the Drizzle schema (src/db/schema.ts → src/db/migrations).
npm run db:gen

# Apply migrations against the local Postgres.
npm run db:migrate

# Inspect data via Drizzle Studio (web UI on the URL it prints).
npm run db:studio

# Stop Postgres (keeps data on the named volume).
npm run db:down

# Wipe local data (drops the volume — fresh DB next `db:up`).
docker compose -f docker-compose.dev.yml down -v
```

Connection string when running outside Docker (and the default baked into
`.env.example` / `.dev.vars.example`):

```
postgresql://sonic:sonic@localhost:5432/sonic_bloom_dev
```

The Drizzle client factory at `src/db/client.ts` reads `DATABASE_URL` from the
environment. Tests bypass this by passing a `pg.Pool` (or pg-mem shim) to
`createDb({ pool })` directly, so the suite never opens a real connection.
