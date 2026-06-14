# Agent guide — Sonic Bloom (sonic-bloom-main)

## Purpose

Next.js 15 (App Router) + React + TypeScript: a music library and playback UI. Marketing landing at `/`; main app under `/app` with sidebar, player bar, search, and library/detail/settings routes. **Data is mock/in-memory** (`src/lib/mock-data.ts`, `src/lib/store.ts`); there is no backend or real streaming integration in this repo yet.

## Commands

| Task | Command |
|------|---------|
| Dev server (port **3000**) | `npm run dev` |
| Dev server for Playwright (port **3330**) | `npm run dev:e2e` |
| Production build | `npm run build` (`next build` → `.next/`; not a Cloudflare static bundle by itself) |
| Start (after build) | `npm run start` |
| Lint | `npm run lint` (`next lint`) |
| Unit tests (Vitest) | `npm test` |
| Watch tests | `npm run test:watch` |
| E2E (Playwright) | `npm run test:e2e` (config: `playwright.config.ts`; plan: `docs/TEST-PLAN.md`) |
| Firebase emulators (Auth, Firestore, Storage, UI) | `npm run emulators:start` (requires `firebase-tools` / `npx`) |
| Cloudflare Workers Builds (deploy checklist) | `docs/CLOUDFLARE_WORKERS_BUILDS.md` |
| Firebase migration proposal | **Rejected** 2026-05-13 — archived in `docs/rejected/`. See `docs/rejected/README.md` for rationale. |
| List Pages projects (after `wrangler login`) | `npm run cf:pages:list` |
| Deploy with optional slug override | Set **`CF_PAGES_PROJECT_NAME`** in CI, then `npm run deploy` (see `scripts/pages-deploy.mjs`) |
| Manual Pages deploy (GitHub) | Actions → **Deploy Cloudflare Pages** — needs secret **`CLOUDFLARE_API_TOKEN`**; see `docs/CLOUDFLARE_WORKERS_BUILDS.md` §6 |
| Cloudflare build still `[10000]` after GitHub secret | GitHub and Cloudflare use **separate** tokens — set the same Pages-capable token in **Cloudflare project Variables** too; see **`docs/CLOUDFLARE_WORKERS_BUILDS.md` §7** |
| **Build token deleted or rolled** (Workers Builds) | Update **Build token** in **Worker Builds** settings in the dashboard; see **`docs/CLOUDFLARE_WORKERS_BUILDS.md`** troubleshooting table. |
| Full verify (lint + unit + E2E + build) | `npm run verify` |
| Cloudflare Pages local | `pages:dev` exits with a hint — use **`npm run dev`** for Next; Wrangler needs a static `out/` or `dist/` folder. |
| Cloudflare Pages deploy | `npm run pages:deploy` (requires `wrangler login`; uploads **`out/`** if present, else **`dist/`**) |
| Upload static output | `npm run pages:upload` or `npm run deploy` |
| Firebase rules (Firestore indexes + rules) | `npm run deploy:firebase` (or `npx firebase deploy --only firestore:rules,firestore:indexes`) |
| Firebase Storage rules | `npm run deploy:firebase:storage` after Storage is enabled in console |

Path alias: `@/` → `src/` (see `tsconfig.json`).

## Firebase (production)

- **Project ID:** `the-urban-radio` (default in `.firebaserc`).
- **Firestore (default database):** **asia-southeast3** (Bangkok — suitable for Thailand latency).
- **Rules / indexes:** `firestore.rules`, `firestore.indexes.json`, `storage.rules` at repo root; deploy with Firebase CLI when logged in.
- **Storage:** Open [Firebase Storage](https://console.firebase.google.com/project/the-urban-radio/storage) and complete **Get started** (choose security rules mode, then pick region — prefer **asia-southeast3** if offered for the default bucket). Then run `npx firebase deploy --only storage`.
- **App Hosting (Next.js):** Backend **`urban-radio-web`** in **`asia-southeast1`** (closest [supported region](https://firebase.google.com/docs/app-hosting/about-app-hosting#locations) to Thailand; Firebase App Hosting has no Bangkok region). Live domain: [urban-radio-web--the-urban-radio.asia-southeast1.hosted.app](https://urban-radio-web--the-urban-radio.asia-southeast1.hosted.app). Deploy from this repo: `npm run deploy:apphosting` (uploads source → Cloud Build). Track builds/rollouts in [App Hosting console](https://console.firebase.google.com/project/the-urban-radio/apphosting). Optional: connect GitHub (**urban-radio-web** → *Settings* → *Deployment*) on repo `KunanonJ/radio-development` for automatic rollouts on push. Config files: root `apphosting.yaml`, `firebase.json` → `apphosting`.

## App structure

- Routes live under **`src/app/`** (App Router). Feature screens are composed from **`src/views/`** — do **not** use **`src/pages/`** for routing (that name is reserved by the Pages Router).
- Auth gate: cookie session + **`NEXT_PUBLIC_REQUIRE_AUTH`** (same idea as the old `VITE_REQUIRE_AUTH`).

## Cloudflare (hosting + API)

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
- **State**: Player/queue/global UI → Zustand store. **TanStack Query** is wired in providers but may be unused until a real API exists.
- **Routing**: Add App Router segments under `src/app/`; keep `/app` children consistent with sidebar links.

## Scope notes for changes

- Do not assume a real audio element or OAuth flows exist unless you add them.
- Integration types in `types.ts` are forward-looking; settings UI may reference them with mock status.

## Documentation

- Root **`README.md`** is still a Lovable placeholder; update it when the project is described for humans. **Do not** add extra markdown docs unless the user asks.

## Cursor / agent work rules

- **`.cursor/rules/*.mdc`** — project work rules for Cursor (workflow + frontend patterns). They complement this file; keep them in sync when conventions change.
