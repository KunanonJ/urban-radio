# Agent guide — Sonic Bloom (deployed as urban-radio)

## Purpose

Next.js 16 (App Router) + React 18 + TypeScript: a music library and playback UI. Marketing landing at `/`; main app under `/app` with sidebar, player bar, search, and library/detail/settings routes. **Backend is live**: PostgreSQL (Drizzle ORM, `src/db/`), S3-compatible object storage (Cloudflare R2 via `@aws-sdk/client-s3`), and jose JWT session auth (`src/server/auth/`). The UI also ships mock seed content (`src/lib/mock-data.ts`, `src/lib/store.ts`) used by some views and E2E specs.

## Commands

| Task | Command |
|------|---------|
| Dev server (port **3000**) | `npm run dev` |
| Dev server for Playwright (port **3330**) | `npm run dev:e2e` |
| Production build | `npm run build` (`next build`; `output: 'standalone'` → `.next/standalone/server.js`) |
| Start (after build) | `npm run start` |
| Lint | `npm run lint` (`eslint .`) |
| Unit tests — node project (the gate, pg-mem) | `npm test` (`vitest run --project=node`) |
| UI tests — jsdom project (best-effort, OOMs) | `npm run test:ui` (`vitest run --project=jsdom`) |
| Migration tests | `npm run test:migrations` |
| Watch tests | `npm run test:watch` |
| E2E (Playwright) | `npm run test:e2e` (config: `playwright.config.ts`; needs `DATABASE_URL`; webServer runs `next dev`; plan: `docs/TEST-PLAN.md`) |
| Full verify (lint + node unit + migrations + E2E + build) | `npm run verify` |
| Local dev Postgres up / down | `npm run db:up` / `npm run db:down` (`docker-compose.dev.yml`, `sonic`/`sonic`) |
| Generate migrations (Drizzle) | `npm run db:gen` (`drizzle-kit generate`) |
| Apply migrations (Drizzle → Postgres) | `npm run db:migrate` (`drizzle-kit migrate`) |
| Drizzle Studio | `npm run db:studio` |
| Seed Railway admin (org + station `urban-radio` + admin user) | `node scripts/seed-railway-admin.mjs` (configurable via `ORG_*` / `STATION_*` / `ADMIN_USERNAME` / `ADMIN_PASSWORD`) |
| Postgres backup → S3 | `npm run backup:pg` (`scripts/backup-pg-to-s3.mjs`) |
| R2 orphan janitor | `npm run janitor:r2` (`scripts/janitor-r2-orphans.mjs`) |
| Docker build (Railway image) | `docker build -t sonic-bloom .` (`Dockerfile`, `node:22-alpine`, runs `node server.js`) |
| **Legacy** — Firebase emulators / rules / App Hosting | `npm run emulators:start`, `deploy:firebase*`, `deploy:apphosting` — pre-migration only (see Legacy section) |
| **Legacy** — Cloudflare Pages/Workers/D1 | `npm run cf:pages:list`, `pages:deploy`, `deploy`, `db:migrate:remote`, `docs/CLOUDFLARE_WORKERS_BUILDS.md` — pre-migration only (see Legacy section) |

Path alias: `@/` → `src/` (see `tsconfig.json`).

## Deploy & runtime (production)

- **Host:** [Railway](https://railway.com), Docker deploy. `railway.json` → `builder: DOCKERFILE`, `startCommand: node server.js`, `healthcheckPath: /api/healthz`. The `Dockerfile` is a 3-stage `node:22-alpine` build that ships only the Next `standalone` output (`server.js` + `public/` + `.next/static/`).
- **Repo / branch:** `github.com/KunanonJ/urban-radio`, branch `main`. Railway's **native GitHub integration** auto-deploys on push to `main`.
- **Token-based deploy (opt-in):** `.github/workflows/deploy-railway.yml` runs `railway up` only when the repo variable `RAILWAY_DEPLOY_VIA_TOKEN == 'true'` (uses `RAILWAY_TOKEN` / `RAILWAY_PROJECT_ID` / `RAILWAY_SERVICE_NAME` secrets). Leave unset to rely on the native integration.
- **Database:** PostgreSQL via Drizzle ORM. Client in `src/db/client.ts` (`getDb()` / `createDb()` need `DATABASE_URL`). Schema in `src/db/schema.ts`; apply migrations with `npm run db:migrate`.
- **Storage:** S3-compatible (Cloudflare R2 endpoint) via `@aws-sdk/client-s3` + presigner. Env: `STORAGE_ENDPOINT_URL`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_REGION` (optional).
- **Auth:** jose HS256 JWT session cookies. `AUTH_JWT_SECRET` (≥32 bytes), **fail-closed in production** (`src/server/auth/require-session.ts` returns **503** for non-public routes if unset; dev/test allow through). Middleware (`src/middleware.ts`, matcher `/api/:path*`) gates `/api/*` only — not `/app`. `src/server/auth/require-station.ts` gates `/api/catalog/*` and is fail-closed (**401** without a valid session).
- **Backups:** `.github/workflows/pg-backup.yml` runs a daily `pg_dump` → S3 (`scripts/backup-pg-to-s3.mjs`).

## Legacy — Firebase (pre-migration, NOT the active runtime)

> Firebase is no longer how this app runs. `firebase` (^11.9.0) is still a not-yet-removed dependency and `functions/` + Firebase config files still exist, but production runs on Railway/Postgres (above). Kept for history.

- **Project ID:** `the-urban-radio` (default in `.firebaserc`).
- **Firestore (default database):** **asia-southeast3** (Bangkok — suitable for Thailand latency).
- **Rules / indexes:** `firestore.rules`, `firestore.indexes.json`, `storage.rules` at repo root; deploy with Firebase CLI when logged in.
- **Storage:** Open [Firebase Storage](https://console.firebase.google.com/project/the-urban-radio/storage) and complete **Get started** (choose security rules mode, then pick region — prefer **asia-southeast3** if offered for the default bucket). Then run `npx firebase deploy --only storage`.
- **App Hosting (Next.js):** Backend **`urban-radio-web`** in **`asia-southeast1`** (closest [supported region](https://firebase.google.com/docs/app-hosting/about-app-hosting#locations) to Thailand; Firebase App Hosting has no Bangkok region). Live domain: [urban-radio-web--the-urban-radio.asia-southeast1.hosted.app](https://urban-radio-web--the-urban-radio.asia-southeast1.hosted.app). Deploy from this repo: `npm run deploy:apphosting` (uploads source → Cloud Build). Track builds/rollouts in [App Hosting console](https://console.firebase.google.com/project/the-urban-radio/apphosting). Optional: connect GitHub (**urban-radio-web** → *Settings* → *Deployment*) on repo `KunanonJ/radio-development` for automatic rollouts on push. Config files: root `apphosting.yaml`, `firebase.json` → `apphosting`.

## App structure

- Routes live under **`src/app/`** (App Router), including the API under `src/app/api/` (e.g. `GET /api/healthz` → `src/app/api/healthz/route.ts`). Feature screens are composed from **`src/views/`** — do **not** use **`src/pages/`** for routing (that name is reserved by the Pages Router).
- Auth gate: jose JWT session cookie enforced by `src/middleware.ts` on **`/api/*`** (not `/app`); per-route station membership via `src/server/auth/require-station.ts`. See the Auth bullet under **Deploy & runtime**.

## Legacy — Cloudflare (pre-migration, NOT the active runtime)

> The app no longer runs on Cloudflare. `wrangler` (^4.80.0) is still a not-yet-removed dependency and `functions/` + `wrangler.toml` still exist, but production runs on Railway/Postgres. The top-level `migrations/*.sql` + `better-sqlite3` tests exercise the **legacy D1/SQLite migration path only** — the runtime DB is Postgres. Kept for history.

- **Workers Builds / custom deploy step**: after producing a **static** folder, run **`bun run deploy`** (or **`npm run deploy`**). `npm run deploy` uploads **`out/`** (Next static export) if it exists, otherwise **`dist/`** (legacy). **`next build` alone does not create `out/` or `dist/`** — add static export (`output: 'export'`) plus `generateStaticParams`, or an adapter (e.g. OpenNext), before Pages deploy.
- **Git-connected Pages**: set the dashboard **build output directory** to match your static output (`out` or `dist`). `wrangler.toml` → `pages_build_output_dir` is often `dist` for legacy; align dashboard and scripts.
- **SPA routing (legacy Vite)**: `public/_redirects` — `/*` → `/index.html` (200 rewrite) when serving a static export.
- **Backend (edge)**: **Pages Functions** in `functions/` — only `/api/*` invokes Functions (`public/_routes.json` copied with static assets) so static traffic stays cheap.
- **Sample endpoint**: `GET /api/health` → `functions/api/health.ts`.
- **Frontend API base**: `src/lib/api-base.ts` — optional **`NEXT_PUBLIC_API_BASE_URL`** for a non–same-origin API later; default is same-origin `/api`.
- **Secrets (local)**: copy `.dev.vars.example` → `.dev.vars` for `wrangler pages dev` (gitignored).
- **Dashboard**: **`name`** in `wrangler.toml` must match the **Pages project slug** (`npm run cf:pages:list` after `wrangler login`). Do **not** put **`account_id`** in `wrangler.toml` for Pages — **`wrangler pages deploy`** rejects it. Account comes from the linked project / **`CLOUDFLARE_API_TOKEN`**. The account Workers subdomain is **`urbanradio.workers.dev`**. If deploy fails with **Authentication error [10000]**, the **API token** must include **Account → Cloudflare Pages → Edit** (dashboard Super Admin does not apply to tokens); see **`docs/CLOUDFLARE_WORKERS_BUILDS.md`**.
- **Cloudflare Access**: edge login (Zero Trust → Access) protects the hostname before the app loads; optional JWT enforcement on `/api/*` when `ACCESS_TEAM_DOMAIN` and `ACCESS_POLICY_AUD` are set on the Pages project. See **`CLOUDFLARE_ACCESS.md`**.
- **App login (username/password)**: optional **`NEXT_PUBLIC_REQUIRE_AUTH=true`** — requires a **Login** page before `/app`. Pages Functions use **`AUTH_JWT_SECRET`** (HS256 session JWT in `sb_session` cookie) and D1 table **`auth_users`** (`migrations/0003_auth_users.sql`). Demo user: **`demo` / `demo`**. Without `AUTH_JWT_SECRET`, the UI treats auth as not configured and still allows `/app` when `NEXT_PUBLIC_REQUIRE_AUTH` is true (see `auth.serverNotConfigured` copy).

## Layout

- **`src/app/`** — `layout.tsx`, `providers.tsx`, route segments under `app/` and `login/`.
- **`src/views/`** — Page-level views (library, queue, settings, etc.).
- **`src/components/`** — `AppChrome`, `PlayerBar`, feature components, `ui/` (shadcn/Radix).
- **`src/lib/types.ts`** — Domain types (`Track`, `Album`, `Playlist`, `SourceType`, integrations).
- **`src/lib/store.ts`** — Zustand `usePlayerStore`: playback, queue, volume, UI flags (`isFullscreenPlayer`, `isSearchOpen`).
- **`src/lib/mock-data.ts`** — Seed content for the UI.

## Conventions

- **Styling**: Tailwind + CSS variables (`src/app/globals.css`); follow existing patterns (`glass`, `surface-*`, sidebar/player CSS vars).
- **New UI**: Extend shadcn components in `src/components/ui/` only when needed; feature components live in `src/components/`.
- **State**: Player/queue/global UI → Zustand store. **TanStack Query** is wired in providers for the live `/api/*` server data.
- **Routing**: Add App Router segments under `src/app/`; keep `/app` children consistent with sidebar links.

## Environment contract

- **`.env.example` / `.env.local.example`**: `DATABASE_URL` is **required**. Local dev Postgres comes from `docker-compose.dev.yml` (`sonic`/`sonic`).
- **Production vars (set on Railway, never committed)**: `AUTH_JWT_SECRET`, `STRIPE_WEBHOOK_SECRET`, `STORAGE_ENDPOINT_URL`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`, optional `STORAGE_REGION`, `STREAM_CONTROL_URL` / `STREAM_CONTROL_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `AI_AUDIO_URL_ALLOWED_HOSTS`.
- Reference env vars by **name only** — never commit real values.

## CI & tests

- **`.github/workflows/ci.yml`**: job **`verify`** is the gate — `npm run verify` (lint → node vitest → migration tests → Playwright E2E against a `postgres:15` service + `db:migrate` → `next build`). A separate **`ui-tests`** job runs the jsdom vitest project with `continue-on-error: true` due to a known JS-heap OOM in the component suite.
- **Vitest two-project split**: `npm test` = node project (the gate, ~1210 tests, pg-mem); `npm run test:ui` = jsdom project (best-effort, OOMs).
- **E2E**: Playwright needs `DATABASE_URL`; webServer runs `next dev`. The `track-actions` suite is deferred via `test.describe.fixme` because `/api/catalog/tracks` is now auth-fail-closed and those specs never log in.

## Security headers (`next.config.ts`)

- CSP allows `fonts.googleapis.com` (style-src) + `fonts.gstatic.com` (font-src). Strict headers: HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`. `X-Powered-By` is stripped (`poweredByHeader: false`).

## Scope notes for changes

- Do not assume a real audio element or OAuth flows exist unless you add them.
- Integration types in `types.ts` are forward-looking; settings UI may reference them with mock status.

## Documentation

- Root **`README.md`** describes the project for humans (Next.js 16 radio-automation app); keep it in sync with this file. **Do not** add extra markdown docs unless the user asks.

## Cursor / agent work rules

- **`.cursor/rules/*.mdc`** — project work rules for Cursor (workflow + frontend patterns). They complement this file; keep them in sync when conventions change.
