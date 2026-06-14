# Sonic Bloom — Master Roadmap

**Audience:** the AI/human pair driving this multi-month upgrade. Each phase is a self-contained scope with its own waves of parallel agents. Detailed kickoff briefs live alongside this file as `PHASE-N-KICKOFF.md`.

**Last updated:** 2026-05-13 (end of Phase 1).

---

## 0. Status overview

**Last continuous run completed: 2026-05-14.** Phases 0–6 shipped in one continuous session with 30+ parallel agents. Test suite went from 86 → **1166** (1145 main + 21 migration). Phases 7–8 deferred.

| # | Phase | Status | Sessions used | Kickoff doc |
|---|---|---|---|---|
| 0 | Truth-telling + test backfill | ✅ **Done** | 1 | (recap below) |
| 1 | Foundation: schema + auth + Library (S1) | ✅ **Done** | 2 | [PHASE-1-KICKOFF.md](./PHASE-1-KICKOFF.md) |
| 2 | Hour Clock Builder + Scheduler grid (S2/S3) | ✅ **Done** | 1 | [PHASE-2-KICKOFF.md](./PHASE-2-KICKOFF.md) |
| 3 | Live Studio + Cart Wall (S4/S5) — *real streaming deferred to R0* | ✅ **Done (non-R0)** | 1 | §4 |
| 4 | Voice Tracking + AI abstractions (S6) — *real provider keys deferred* | ✅ **Done (stubbed providers)** | 1 | §5 |
| 5 | Reports + Royalties + Audit log (S7) | ✅ **Done** | 1 | §6 |
| 6 | Comments (slim) — *real-time CRDT/presence deferred to 6.1* | ✅ **Done (slim)** | 1 | §7 |
| 7 | Mobile PWA + Settings polish + i18n expand + a11y audit (S8) | 🚧 **Next** | 1–2 | §8 |
| 8 | Production hardening + launch | ⏳ Blocked (R0 — needs Stripe/Sentry/AzuraCast credentials) | 1–2 | §9 |

**Critical path remaining:**
- Phase 6.1 (Yjs CRDT presence on Durable Objects) — non-blocking nice-to-have
- Phase 7 (PWA + a11y + settings + i18n) — fully achievable next session, no external deps
- Phase 8 (production hardening) — needs your decisions on Stripe + Sentry + streaming infra (AzuraCast on Fly.io or Radio.co API)

**R0 walls hit (all deferred with documented swap points):**
- Real Icecast/Shoutcast streaming output — Phase 3 has stub adapter; one-line swap to `AzuraCastAdapter` when credentials land
- Real AI provider calls — Phase 4 has stubbed Voice/Text/Transcribe/ANR; one-line factory swap to ElevenLabs/Anthropic/Deepgram/AudD when keys arrive
- Stripe billing — Phase 8
- Sentry error monitoring — Phase 8

---

## 1. Phase 0 — Truth-telling + test backfill (DONE)

Recap of what landed:
- 86 → 174 tests; 1 lint error / 23 warnings → 0/0
- `usePlayerStore` boots empty (no `mockTracks[0]` seed)
- `BroadcastPage` renders Demo mode when no `NEXT_PUBLIC_ENCODER_URL` (honesty fix)
- Coverage backfill: `broadcast-store`, `cart-store`, `cloud-library-store`, `spot-schedule-store`
- Mock fallbacks removed from `library.ts`, `resolve-track.ts`, all list pages, all detail pages, TrackActionsMenu
- Firebase proposal archived to `docs/rejected/`
- Honest `README.md` replaces Lovable placeholder

---

## 2. Phase 1 — Foundation (DONE)

See [PHASE-1-KICKOFF.md](./PHASE-1-KICKOFF.md). Highlights:
- Migration 0004: 11 Phase 1 tables (orgs, stations, members, categories, radio_tracks, clocks, clock_slots, schedule_assignments, play_log, voice_tracks, audit_log) + 18 indexes
- Migration 0005: idempotent default org/station/categories seed; demo user as admin
- `functions/_lib/{require-station,catalog-queries,upload-helpers}.ts` — auth gate + pure SQL builders
- 8 catalog endpoints rewritten: station-scoped + keyset cursor pagination + 401/403/404
- `/api/upload` now writes `radio_tracks` with content-hash dedup before R2 put
- Library S1 (`/app/library/tracks`): TanStack Table + Virtual + faceted filters + preview pane + infinite scroll
- Tests: 174 → **279** (274 main + 5 migration); lint 0; build green; 13/13 routes 200
- New deps: `@tanstack/react-table`, `@tanstack/react-virtual`, `cmdk`, `@testing-library/dom`, `better-sqlite3`, `@types/better-sqlite3`
- New design system: 4 elevation levels, CB-safe Okabe-Ito accent, typography rhythm
- Cmd+K palette with 8 nav actions

---

## 3. Phase 2 — Hour Clock Builder + Scheduler grid (NEXT)

See [PHASE-2-KICKOFF.md](./PHASE-2-KICKOFF.md). Summary:

**Goal:** Build Hour Clock Builder (S2) and Scheduler Grid (S3) end-to-end against `clocks` / `clock_slots` / `schedule_assignments` so an operator can define an hour and drop it on a weekly calendar.

**Agent fleet:**
- **Wave 4a** (2 parallel R1 agents): P2-α clocks CRUD + JSON `category_id` fix; P2-β schedule CRUD + RRULE
- **Wave 4b** (2 parallel R2 agents after 4a): P2-γ ClockBuilder UI; P2-δ Scheduler Grid UI

**Decisions to lock (D6–D11):** RRULE lib (`rrule@^2.8`), conflict semantics (override-with-dialog), defer year heatmap to Phase 2.5, explicit save (no auto-save), preview = slot order + durations only, ship `category_id` in JSON during P2-α.

**Target deltas:** +60 tests; new routes `/app/clocks`, `/app/clocks/[id]`, `/app/schedule`; Cmd+K extended.

---

## 4. Phase 3 — Live Studio + Cart Wall + Real Streaming (S4/S5)

**This is the R0 phase.** Without a real encoder, the app remains a music UI in radio chrome.

### 4.1 External infrastructure decisions to lock first

| # | Decision | Recommendation |
|---|---|---|
| D12 | Streaming engine | **Self-host AzuraCast on Fly.io** (free, AGPL, mature Liquidsoap inside). Alt: Radio.co API proxy ($$, faster to MVP). |
| D13 | Stream control plane | REST over HTTPS from Pages Functions → AzuraCast admin API. Mutual auth via a long-lived API key kept in Pages env. |
| D14 | Browser "Go Live" pipeline | WebRTC → server-side gateway (Janus or simple FFmpeg/wrtc bridge on Fly.io) → Icecast push to AzuraCast |
| D15 | Now-playing metadata sink | Push to AzuraCast's `/api/internal/{station}/notify` + write to `play_log` on every track start |
| D16 | Aircheck recording | AzuraCast records the master mount; download via signed URLs into a Pages Functions proxy for compliance access |
| D17 | Stream failover | AzuraCast supports primary + relay mounts; fallback to a static "we'll be right back" loop |

### 4.2 Agent fleet plan

**Wave 5a — Stream control plane (3 parallel):**
- **P3-α** AzuraCast bootstrap: Fly.io app, secrets, mount config, station entry. R0 (operational), but reversible (tear down the Fly.io app).
- **P3-β** Stream control API: `/api/stream/{start,stop,metadata,status}` proxies signed commands to AzuraCast. R1.
- **P3-γ** Play-log writes: extend Phase 2's playout engine to `INSERT INTO play_log` on track start; debounce + batch.

**Wave 5b — Live Studio UI (S4) (3 parallel):**
- **P3-δ** Mixer + meters: Web Audio API graph (AudioContext → Analyser → Compressor → MediaStreamDestination), L/R level meters, mic input device picker.
- **P3-ε** Three-track strip: Now / Next / Queue cards with countdown rings, drag-to-reorder Queue, hotkey bindings (Space, Cmd+Right, J/K).
- **P3-ζ** Quick VT placeholder + health strip: encoder status pill, listener count poll, scheduler heartbeat. (Real VT recording lands in Phase 4.)

**Wave 5c — Cart Wall UI (S5) (1 agent, can run parallel to 5b):**
- **P3-η** Configurable grid (4×4 → 12×12), tabs, hotkeys A–Z + 0–9 + F-keys, audition mode, visual states (armed-pulse, playing-sweep, held, ducked). Replaces the current 12-slot prototype.

**Wave 5d — Browser "Go Live" (R0, only after 5a/b stable):**
- **P3-θ** WebRTC capture → server bridge → Icecast push. The trickiest piece; budget 1 full session.

### 4.3 Exit criteria

A real listener at a real URL hears a real schedule for 24 hours uninterrupted. Operator can take the mic from the browser; cart slots fire in < 50 ms.

### 4.4 Honest dissent

This phase **cannot** ship without the external infrastructure decision and budget. The CF Pages Functions runtime is stateless and can never host an Icecast TCP stream. Either commit to running AzuraCast / Fly.io or proxy to a managed provider (Radio.co, RadioKing). **Pause here for explicit user confirmation before spawning Wave 5a.**

---

## 5. Phase 4 — Voice Tracking + AI (S6)

### 5.1 Decisions to lock

| # | Decision | Recommendation |
|---|---|---|
| D18 | Voice cloning provider | **ElevenLabs** — best quality, ~$0.30/min generated audio |
| D19 | Text-gen provider | **Anthropic Claude (Haiku 4.5)** for VT scripts. Cached + cheap |
| D20 | Transcription / live captions | **Deepgram** (cheaper than AssemblyAI for our volume) |
| D21 | Audio recognition (ANR — auto-log incoming streams) | **AudD** (cheapest at our volume) |
| D22 | Cost guardrails | Per-org monthly cap; refuse generation when cap hit; cost displayed in UI before generation |

### 5.2 Agent fleet plan

**Wave 6a (3 parallel):**
- **P4-α** Voice-track recorder: `MediaRecorder` capture in-browser, upload to R2, INSERT `voice_tracks`. Plays the surrounding songs as preview.
- **P4-β** Waveform editor: 3-track timeline (out / VT / in) with WaveSurfer.js v7 Regions plugin. Drag cue/intro/outro markers. Snap to silence/transient.
- **P4-γ** AI provider abstractions: `src/lib/ai/{voice,text,transcribe,anr}.ts` thin wrappers around Vercel AI SDK 5 + ElevenLabs SDK + Deepgram. Mockable in tests.

**Wave 6b (3 parallel after 6a):**
- **P4-δ** AI VT generation drawer: voice picker (cloned / stock / AI), content topic, tone, generate → drag into middle track
- **P4-ε** Auto-segue suggestion: BPM/key/energy analysis on adjacent tracks → propose crossfade point. Uses cached audio analysis stored in `radio_tracks` (extend schema migration 0006 with `analysis_json`).
- **P4-ζ** Auto-captions for live stream + ANR for incoming streams; writes to `play_log` with `source='auto_recognition'`

### 5.3 Exit criteria

A remote producer drops a frontsell into tonight's drive-time clock from a phone in < 60 seconds. AI VT generation under $0.05/segment. Live captions surface in the public player widget.

---

## 6. Phase 5 — Reports + Royalties + Multi-station (S7)

### 6.1 Decisions to lock

| # | Decision | Recommendation |
|---|---|---|
| D23 | Charts library | **Tremor** (Recharts under the hood, Tailwind-native) |
| D24 | Royalty PRO formats v1 | **ASCAP + BMI + SoundExchange** ship in v1. SOCAN/PRS/GEMA/JASRAC follow in v1.1. |
| D25 | Multi-station enablement | UI ships station switcher in v1 (data model is already multi-station from Phase 1) |
| D26 | Geography library | **Mapbox** (free dev tier; sub if cost matters: Maptiler) |

### 6.2 Agent fleet plan

**Wave 7a (3 parallel):**
- **P5-α** Reports dashboard (S7): Tremor cards in 5 tabs (Overview / Trends / Geography / Milestones / Royalties). Reads from `play_log` aggregations.
- **P5-β** Royalty exports: pure CSV/XML emitter per PRO format. Each format has its own validator + golden-file test against a known-good sample.
- **P5-γ** Multi-station dashboard + station switcher in TopBar/Sidebar; mirrors the schema's existing `station_members` semantics.

**Wave 7b (1 agent):**
- **P5-δ** Audit-log UI: filterable activity feed across station with CSV export. Reads from the `audit_log` helper that lands in Phase 2.

### 6.3 Exit criteria

Monthly royalty export validates against ASCAP's sample importer. Audit log exportable as JSON + CSV. Station switcher loads sub-second.

---

## 7. Phase 6 — Real-time collaboration

Can run in parallel with Phase 4. Highest-leverage long-term differentiator vs RadioBOSS.

### 7.1 Decisions to lock

| # | Decision | Recommendation |
|---|---|---|
| D27 | Collab platform | **Liveblocks** managed Yjs for speed. Migrate to self-hosted Yjs on Durable Objects if cost grows. |
| D28 | Surfaces with CRDT | **Hour Clock Builder + Scheduler Grid + Voice Track editor**. Library remains TanStack Query (no CRDT). |
| D29 | Comments scope | Anchored to clocks, clock_slots, schedule_assignments, voice_tracks. NOT on tracks (use existing notes field). |
| D30 | Presence indicators | Avatar in top-right (Figma pattern); cursor in canvas/scheduler; locked-row indicator on edit |

### 7.2 Agent fleet plan

**Wave 8 (3 parallel):**
- **P6-α** Liveblocks provider + token endpoint (`/api/liveblocks/auth`) + room model
- **P6-β** CRDT integration on Clock Builder (replaces optimistic updates with Yjs sync) + scheduler grid
- **P6-γ** Comment threads + presence avatars; reuses shadcn Popover for comment UI

### 7.3 Exit criteria

Two browsers edit the same clock simultaneously without conflicts. Sub-100 ms cursor latency. Comments deliver-or-die.

---

## 8. Phase 7 — Mobile PWA + Settings polish + i18n expand (S8)

### 8.1 Decisions to lock

| # | Decision | Recommendation |
|---|---|---|
| D31 | PWA strategy | **Next-PWA** with service worker; offline-only the monitor screen; pre-cache static assets |
| D32 | Push notifications | Web Push API + VAPID keys; defer iOS until they support it (Safari 16.4+ supports) |
| D33 | i18n languages for v1 expansion | **en, th, es, fr, de, pt, ja, zh** |
| D34 | Settings architecture | Linear-style left-rail (already designed in Phase 1 north-star); not a modal |
| D35 | Accessibility audit | Axe-core in CI; manual JAWS/NVDA/VoiceOver pass; WCAG 2.1 AA per April 2026 deadline |

### 8.2 Agent fleet plan

**Wave 9 (4 parallel):**
- **P7-α** PWA shell: manifest, service worker, install prompt, three-task companion (Now-playing monitor, VT from phone, emergency cart-fire)
- **P7-β** Settings rewrite (S8): left-rail navigation, sections (station / streams / talent / integrations / imaging / compliance / audio / billing); no modal-of-doom
- **P7-γ** i18n expansion: add es/fr/de/pt/ja/zh locales (machine-translate, human-review the on-air-critical strings)
- **P7-δ** Accessibility audit + fixes: axe-core CI integration, screen-reader nav, color-blind palette test, keyboard reach for every action

### 8.3 Exit criteria

PWA installable from `/app`; 3 mobile tasks work without network for 30 s outage; settings is keyboard-navigable; axe-core CI passes; WCAG 2.1 AA verified manually on Library + Live Studio + Cart Wall.

---

## 9. Phase 8 — Production hardening + launch

### 9.1 Decisions to lock

| # | Decision | Recommendation |
|---|---|---|
| D36 | Pricing model | SaaS-only, free tier (1 station, 100 tracks, no streaming) + paid tiers (streaming, multi-station, AI quota, royalty exports) |
| D37 | Billing provider | **Stripe Billing** with metered usage for AI minutes and streaming hours |
| D38 | Observability | **Cloudflare Analytics** (built-in) + **Sentry** for errors + **Better Stack** for uptime |
| D39 | Status page | `status.sonicbloom.app` (managed via Better Stack) |
| D40 | Backup strategy | Daily off-site D1 dump (R2); R2 audio files versioned; weekly disaster-recovery drill |
| D41 | Support tier | Email + community Slack for free; priority email for paid; dedicated for enterprise (≥5 stations) |
| D42 | Legal | Privacy policy, ToS, DSAR self-serve, music-licensing disclaimer (we don't cover SoundExchange/BMI/ASCAP — operator's responsibility) |

### 9.2 Agent fleet plan

**Wave 10 (4 parallel):**
- **P8-α** Stripe billing integration + plan gates in the UI
- **P8-β** Observability wiring: Sentry, Better Stack, Cloudflare analytics dashboards
- **P8-γ** Backup + DR drill: nightly D1 dump → R2; weekly automated restore test in a staging D1
- **P8-δ** Legal pages + DSAR self-serve + status page

### 9.3 Exit criteria

A new user can sign up, upload tracks, schedule an hour, take the mic, and stream to a public URL. Billing meters minutes accurately. Sentry catches errors. Backups verified by a real restore test.

---

## 10. Cross-cutting concerns

### 10.1 Decisions still outstanding across all phases

D6–D11 (Phase 2), D12–D17 (Phase 3), D18–D22 (Phase 4), D23–D26 (Phase 5), D27–D30 (Phase 6), D31–D35 (Phase 7), D36–D42 (Phase 8). **Phase 3 (streaming infra) is the biggest gate** — it cannot start without that decision.

### 10.2 Risk register (top 8)

| # | Risk | Probability | Mitigation |
|---|---|---|---|
| R1 | Streaming sidecar (AzuraCast / Liquidsoap) maintenance burden | High | Treat as off-the-shelf; never customize beyond config |
| R2 | Liveblocks bill at scale | Med | Build with Yjs primitives; swap to self-hosted Durable Objects if cost >$X/mo |
| R3 | AI cost spirals | Med | Hard caps per org + plan; show $ per generation in UI |
| R4 | Royalty template formats change | Med | Auto-pull from each PRO's spec; test against validators monthly |
| R5 | WCAG audit reveals deep refactor | Low | Radix is pre-tested; axe-core in CI from Phase 7 |
| R6 | D1 10 GB / DB limit hit on `play_log` | Med | Partition by station + month; archive to R2 |
| R7 | Multi-station feature breaks single-station users | High | Already mitigated — schema is multi-tenant from day 1; UI ships single-station mode by default |
| R8 | "Honesty bug" regresses (fake feature ships labelled real) | Med | Mandatory PR-review checklist; lint rule for `mock*` imports in production code |

### 10.3 Tracked follow-ups (close opportunistically)

- `category_id` in API JSON (slated for P2-α)
- `Track` type extensions: `bpm`, `playCount`, `lastPlayedAt`, `analysisJson` (Phase 4 extension)
- `audit_log` helper module (target Phase 2, P2-α)
- i18n facet labels in `FacetedFilterBar` (Phase 7)
- Unused `search.noResults` i18n key (delete in Phase 7)
- `SettingsPage` + `PlaylistGeneratorPage` mock imports → real integrations API (Phase 7)
- P1-δ transient upload-test timeouts (couldn't reproduce; monitor)

### 10.4 Test-suite trajectory

| Phase | Tests at end | Total Δ |
|---|---|---|
| Start | 40 | — |
| 0 | 86 | +46 |
| 1 | 279 | +193 |
| 2 (target) | ≥ 339 | +60 |
| 3 (target) | ≥ 419 | +80 |
| 4 (target) | ≥ 489 | +70 |
| 5 (target) | ≥ 549 | +60 |
| 6 (target) | ≥ 599 | +50 |
| 7 (target) | ≥ 659 | +60 |
| 8 (target) | ≥ 689 | +30 |

### 10.5 Cost ballpark (annualized, single mid-size station)

| Service | Cost/mo |
|---|---|
| Cloudflare Workers/Pages + D1 + R2 | ~$30 |
| Fly.io (AzuraCast container) | ~$25 |
| Liveblocks (managed Yjs) | ~$20 |
| ElevenLabs (VT generation, light usage) | ~$50 |
| Deepgram (captions, light usage) | ~$15 |
| Sentry + Better Stack | ~$30 |
| Stripe (transaction fees) | usage-based |
| **Total infra** | **~$170/mo** |

Pricing should target ≥ 2× margin: free tier (no streaming) loss-leader, $19/mo single-station with streaming, $49/mo multi-station, enterprise quote-on-quote.

---

## 11. Working agreements

1. **Every phase starts with a kickoff brief** (`PHASE-N-KICKOFF.md`). The brief locks decisions and lists allowed files per agent. Use the Phase 1 and Phase 2 briefs as templates.
2. **Every change is TDD-first.** Red → Green → Refactor. Commit at green. Never bypass §1 of CLAUDE.md.
3. **Every agent has a strict file allowlist.** Conflicts across parallel agents are an orchestrator bug, not an agent bug.
4. **Every R1+ change includes a rollback plan in the agent's report.**
5. **Every phase ends with a synthesis verify**: `npm run verify` (lint + main vitest + migration vitest + e2e + build) must pass before declaring done.
6. **No honesty bugs.** A UI element that says "ON AIR" must actually transmit. A "real catalog" must actually query D1, not fall back to mocks.
7. **Out-of-scope is sacred.** Phase 2 does not touch Phase 3 work. Tracked follow-ups go in §10.3 of this file, not into the current PR.

---

## 12. How to use this document

- **Reading cold:** Read §0 status overview, then jump to the current phase's section.
- **Starting a phase:** Open the phase's `PHASE-N-KICKOFF.md` (Phase 1 and 2 exist; Phase 3+ to be written as we reach each).
- **Ending a phase:** Update §0 status, update §10.4 test trajectory, write a one-paragraph recap at the top of the phase's section in this file.
- **Adding a tracked follow-up:** Append to §10.3 with file path + reason.
- **Changing a decision:** Document the old + new + reason in the affected phase's kickoff doc; this master roadmap stays a summary.

---

*This file is the canonical source of phase truth. Detailed per-phase kickoff briefs are the canonical source of execution-level detail. Edit by PR; do not silently edit.*
