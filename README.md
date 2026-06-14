# Sonic Bloom

A Next.js 16 (App Router) + React + TypeScript radio-automation web app under active development. Marketing landing at `/`, authenticated app under `/app` with sidebar, player bar, search, library, queue, spot scheduler, cart wall, and broadcast/automation pages.

The product target is a modern web competitor to RadioBOSS / Radio Cult / RCS Zetta — see the upgrade plan in the project history for the full roadmap. See [AGENTS.md](AGENTS.md) for commands, deployment, and conventions.

## Honest project status (2026-05-13)

### What works today

- Real audio playback ([PlaybackEngine.tsx](src/components/PlaybackEngine.tsx)) with crossfade (2–15s, configurable curves), gapless preload, mute, repeat (off/all/one), shuffle, and connection recovery.
- Queue management: drag-and-drop reorder (@dnd-kit), play-next, add-to-end, persistent across reloads via auto-resume preference.
- Library / Albums / Artists / Playlists routes — read from PostgreSQL (Drizzle ORM) via Next.js Route Handlers (`/api/catalog/*`) when data is seeded. `/api/catalog/*` is fail-closed: it returns 401 without a valid session.
- Cloud upload pipeline: hashed POST to `/api/upload` → S3-compatible storage (Cloudflare R2 endpoint) + Postgres row, browser dedupes by SHA-256 hash.
- Cart wall (12 slots, hotkeys via [CartHotkeysBridge.tsx](src/components/CartHotkeysBridge.tsx)) — slots play through the main player.
- Spot schedule engine — minutes-past-hour insertion with rotation, daypart, and day-of-week filtering ([spot-schedule-engine.ts](src/lib/spot-schedule-engine.ts)).
- Pause / resume scheduler — time-of-day actions ([scheduler-store.ts](src/lib/scheduler-store.ts)).
- Auth: `jose` HS256 session JWT in `sb_session` cookie, Postgres `auth_users` table. `AUTH_JWT_SECRET` is fail-closed in production (503 on non-public routes when unset); dev/test allow through when it is unset. Seed an admin with `node scripts/seed-railway-admin.mjs`.
- i18n (en + th) and 4 themes × 4 accent colors persisted to localStorage.
- Vitest is split into a `node` project (~1210 tests — the CI gate, runs on pg-mem) and a best-effort `jsdom` component project; plus 6 Playwright e2e specs.

### What is NOT implemented (despite UI affordances)

- **Real broadcast output.** The Broadcast page is **DEMO MODE** — toggling "On air" runs a 600 ms mock cycle with no actual encoder. A real Icecast/Shoutcast/RTMP/HLS output requires an external streaming engine (Liquidsoap, AzuraCast, or similar) — the Next.js server itself does not host a persistent TCP stream (optionally driven via `STREAM_CONTROL_URL`). Set `NEXT_PUBLIC_ENCODER_URL` once a real encoder is wired; until then the UI shows a demo banner.
- **Hourly programming clock.** Spot rules exist (top-of-hour, half-hour insertions). A true clock template (typed slots: music / sweeper / liner / VT / ID / news / weather) is not implemented.
- **Voice tracking.** No mic capture, no segue editor, no AI-generated voice tracks.
- **Cue / fade / intro / outro points per track.** `Track.duration` only; crossfade is global, not per-track.
- **Now-playing metadata push** (FTP / HTTP / XML / webhook). Only clipboard copy is wired.
- **Aircheck logger** — no `MediaRecorder` capture.
- **Audio processing** beyond crossfade — no LUFS metering, ducking, compressor, EQ.
- **Multi-station / multi-user UI.** The Postgres schema is now multi-org / multi-station with role-based `station_members` (a `require-station` membership gate guards `/api/catalog/*`), but the app UI is still oriented around a single active station.
- **Royalty reports** (SoundExchange / ASCAP / BMI).
- **Real-time collaboration** (multi-cursor presence on schedule / clock builder).

The Next.js Route Handler API (`src/app/api/*`) is read-only for catalog, plus `POST /api/upload` and `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/me`.

## Stack

- **Framework:** Next.js 16 (App Router, `output: "standalone"`) + React 18 + TypeScript 5
- **Styling:** Tailwind CSS + shadcn/ui (Radix primitives) + `tailwindcss-animate` + Framer Motion
- **State:** Zustand stores (11 stores) + TanStack Query (catalog cache)
- **Drag-and-drop:** @dnd-kit
- **Forms / validation:** react-hook-form + Zod
- **i18n:** i18next + react-i18next
- **Testing:** Vitest + Testing Library (unit, with pg-mem), Playwright (e2e)
- **Backend:** Next.js Route Handlers + PostgreSQL (Drizzle ORM) + S3-compatible storage (Cloudflare R2 endpoint), deployed on Railway via Docker. (Migrated off Cloudflare Pages Functions + D1; the earlier Firebase proposal was rejected — see [docs/rejected/](docs/rejected/) and [docs/RAILWAY-MIGRATION-PLAN.md](docs/RAILWAY-MIGRATION-PLAN.md). Legacy Cloudflare/Firebase config still lingers in the tree but is no longer how the app runs.)

## Getting started

```bash
npm install
npm run db:up                # local dev Postgres via docker-compose.dev.yml (sonic/sonic)
npm run db:migrate           # apply Drizzle migrations (drizzle-kit migrate; needs DATABASE_URL)
npm run dev                  # next dev on :3000
npm run dev:e2e              # next dev on :3330 (Playwright fixture port)
npm test                     # vitest run (node project — the CI gate)
npm run test:ui              # vitest run (jsdom component project — best-effort)
npm run test:migrations      # legacy D1/SQLite migration tests (better-sqlite3)
npm run test:watch           # vitest watch
npm run test:e2e             # playwright test (needs DATABASE_URL)
npm run lint                 # eslint
npm run verify               # lint + unit + migration tests + e2e + build
```

Path alias: `@/` → `src/`.

Set `DATABASE_URL` (see [.env.example](.env.example)). Seed an admin user with `node scripts/seed-railway-admin.mjs`.

## Project layout

| Path | Purpose |
|---|---|
| [src/app/](src/app/) | App Router segments — marketing `/`, `/login`, `/app/{library,queue,search,album,artist,playlist,now-playing,broadcast,cart,automation,spot-schedule,clocks,schedule,live-studio,voice-tracks,reports,audit-log,settings,how-to-use}`, and the active `/api/*` Route Handlers |
| [src/db/](src/db/) | Drizzle Postgres `client.ts` (`getDb()`), `schema.ts`, and `migrations/` (drizzle-kit) |
| [src/server/auth/](src/server/auth/) | `jose` session JWT, `require-session`, `require-station`, password hashing |
| [src/views/](src/views/) | Page-level views composed by routes |
| [src/components/](src/components/) | AppChrome, PlayerBar, PlaybackEngine, NowPlayingFullscreen, QueueGanttTimeline, GlobalSearch, plus shadcn `ui/` |
| [src/lib/](src/lib/) | Domain types ([types.ts](src/lib/types.ts)), Zustand stores, gantt math, playback persistence, spot schedule engine |
| [functions/api/](functions/api/) | Legacy Cloudflare Pages Functions (pre-migration; no longer the runtime API) |
| [migrations/](migrations/) | Legacy D1/SQLite SQL exercised only by `test:migrations`; runtime migrations live in [src/db/migrations/](src/db/migrations/) |
| [scripts/](scripts/) | `seed-railway-admin.mjs`, `backup-pg-to-s3.mjs`, `janitor-r2-orphans.mjs`, D1→PG migration helpers |
| [e2e/](e2e/) | Playwright specs |
| [docs/](docs/) | Railway migration + production runbook + pentest audits + test plan |
| [docs/rejected/](docs/rejected/) | Archived proposals not adopted |

## Contributing

This repo follows TDD-first development workrules:

- Red → Green → Refactor on every change.
- No production code without a failing test demanding it.
- Commit at green only.
- 80% coverage on critical paths (auth, playback, scheduler, upload).
- See [AGENTS.md](AGENTS.md) §"Cursor / agent work rules" for the full set.

## License

Unlicensed / private project. All rights reserved.
