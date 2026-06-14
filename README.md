# Sonic Bloom

A Next.js 15 (App Router) + React + TypeScript radio-automation web app under active development. Marketing landing at `/`, authenticated app under `/app` with sidebar, player bar, search, library, queue, spot scheduler, cart wall, and broadcast/automation pages.

The product target is a modern web competitor to RadioBOSS / Radio Cult / RCS Zetta — see the upgrade plan in the project history for the full roadmap. See [AGENTS.md](AGENTS.md) for commands, deployment, and conventions.

## Honest project status (2026-05-13)

### What works today

- Real audio playback ([PlaybackEngine.tsx](src/components/PlaybackEngine.tsx)) with crossfade (2–15s, configurable curves), gapless preload, mute, repeat (off/all/one), shuffle, and connection recovery.
- Queue management: drag-and-drop reorder (@dnd-kit), play-next, add-to-end, persistent across reloads via auto-resume preference.
- Library / Albums / Artists / Playlists routes — read from Cloudflare D1 via Pages Functions (`/api/catalog/*`) when data is seeded.
- Cloud upload pipeline: hashed POST to `/api/upload` → R2 + D1 row, browser dedupes by SHA-256 hash.
- Cart wall (12 slots, hotkeys via [CartHotkeysBridge.tsx](src/components/CartHotkeysBridge.tsx)) — slots play through the main player.
- Spot schedule engine — minutes-past-hour insertion with rotation, daypart, and day-of-week filtering ([spot-schedule-engine.ts](src/lib/spot-schedule-engine.ts)).
- Pause / resume scheduler — time-of-day actions ([scheduler-store.ts](src/lib/scheduler-store.ts)).
- Auth: HS256 session JWT in `sb_session` cookie, D1 `auth_users` table (demo user: `demo` / `demo`).
- i18n (en + th) and 4 themes × 4 accent colors persisted to localStorage.
- 86 unit/component tests + 5 Playwright e2e specs.

### What is NOT implemented (despite UI affordances)

- **Real broadcast output.** The Broadcast page is **DEMO MODE** — toggling "On air" runs a 600 ms mock cycle with no actual encoder. A real Icecast/Shoutcast/RTMP/HLS output requires an external streaming engine (Liquidsoap, AzuraCast, or similar) — Cloudflare Pages Functions cannot host a persistent TCP stream. Set `NEXT_PUBLIC_ENCODER_URL` once a real encoder is wired; until then the UI shows a demo banner.
- **Hourly programming clock.** Spot rules exist (top-of-hour, half-hour insertions). A true clock template (typed slots: music / sweeper / liner / VT / ID / news / weather) is not implemented.
- **Voice tracking.** No mic capture, no segue editor, no AI-generated voice tracks.
- **Cue / fade / intro / outro points per track.** `Track.duration` only; crossfade is global, not per-track.
- **Now-playing metadata push** (FTP / HTTP / XML / webhook). Only clipboard copy is wired.
- **Aircheck logger** — no `MediaRecorder` capture.
- **Audio processing** beyond crossfade — no LUFS metering, ducking, compressor, EQ.
- **Multi-station / multi-user.** Single-station, single-org schema.
- **Royalty reports** (SoundExchange / ASCAP / BMI).
- **Real-time collaboration** (multi-cursor presence on schedule / clock builder).

The Cloudflare Pages Functions API is read-only for catalog, plus `POST /api/upload` and `POST /api/auth/login` / `POST /api/auth/logout` / `GET /api/auth/me`.

## Stack

- **Framework:** Next.js 15 (App Router) + React 18 + TypeScript 5
- **Styling:** Tailwind CSS + shadcn/ui (Radix primitives) + `tailwindcss-animate` + Framer Motion
- **State:** Zustand stores (11 stores) + TanStack Query (catalog cache)
- **Drag-and-drop:** @dnd-kit
- **Forms / validation:** react-hook-form + Zod
- **i18n:** i18next + react-i18next
- **Testing:** Vitest + Testing Library (unit), Playwright (e2e)
- **Backend:** Cloudflare Pages Functions + D1 + R2 (the Firebase migration proposal was rejected — see [docs/rejected/](docs/rejected/))

## Getting started

```bash
npm install
npm run dev                  # next dev on :3000
npm run dev:e2e              # next dev on :3330 (Playwright fixture port)
npm test                     # vitest run
npm run test:watch           # vitest watch
npm run test:e2e             # playwright test
npm run lint                 # next lint
npm run verify               # lint + unit + e2e + build
```

Path alias: `@/` → `src/`.

Demo login: `demo` / `demo`.

## Project layout

| Path | Purpose |
|---|---|
| [src/app/](src/app/) | App Router segments — marketing `/`, `/login`, `/app/{library,queue,search,album,artist,playlist,now-playing,broadcast,cart,automation,spot-schedule,settings,how-to-use}` |
| [src/views/](src/views/) | Page-level views composed by routes |
| [src/components/](src/components/) | AppChrome, PlayerBar, PlaybackEngine, NowPlayingFullscreen, QueueGanttTimeline, GlobalSearch, plus shadcn `ui/` |
| [src/lib/](src/lib/) | Domain types ([types.ts](src/lib/types.ts)), Zustand stores, gantt math, playback persistence, spot schedule engine |
| [functions/api/](functions/api/) | Pages Functions: auth, catalog, upload, stream proxy, health |
| [migrations/](migrations/) | D1 SQL: `0001_init`, `0002_seed`, `0003_auth_users` |
| [e2e/](e2e/) | Playwright specs |
| [docs/](docs/) | Cloudflare deploy + test plan |
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
