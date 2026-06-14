# Phase 1 — Kickoff Brief

**Audience:** the AI/human pair resuming this work next session. Read top-to-bottom; act from §6 onward.

**Last updated:** 2026-05-13.

---

## 1. State of the codebase (verified at end of last session)

| Check | Status |
|---|---|
| Vitest | **174 / 174 pass** (27 test files) |
| Lint | **0 errors, 0 warnings** |
| `next build` | clean compile, 25 static pages |
| Dev server | 14 routes return 200 |
| D1 migrations (local) | **0001 + 0002 + 0003 + 0004** applied |
| Production `mockX` fallbacks | none (intentional mocks remain in `SettingsPage` and `PlaylistGeneratorPage` only) |

**Phase 0 + Wave 1 + Wave 2** are complete. The codebase boots empty, broadcast is labeled DEMO, every store is tested, design tokens + Cmd+K palette + EmptyState component are in, and the Phase 1 schema (11 tables, 18 indexes) is live in local D1.

---

## 2. Phase 1 goal — one sentence

Replace the read-only catalog API and the four library views (Tracks / Albums / Artists / Playlists) with **real-data flows** against the new Phase 1 schema (`organizations`, `stations`, `station_members`, `categories`, `radio_tracks`, `clocks`, `clock_slots`, `schedule_assignments`, `play_log`, `voice_tracks`, `audit_log`), shipping a **virtualized library table with faceted filters** as the new Library screen — Screen S1 from the upgrade plan.

---

## 3. Why Library first

From the upgrade plan §4 build order:
> **Library → Hour Clock Builder → Scheduler → Live Studio → Cart Wall → Voice Tracking → Reports → Settings.**

The library screen is the foundation: every other surface reads from it (clocks pick from it, scheduler previews it, live studio cues it, cart wall stocks from it). Get the data path + the UX pattern right here, and the rest of Phase 2–4 reuses the same primitives.

---

## 4. Decisions already locked (do NOT re-litigate)

| Decision | Locked answer |
|---|---|
| Backend | Cloudflare Pages Functions + D1 + R2 (no Firebase) |
| Schema | [migrations/0004_radio_schema.sql](../migrations/0004_radio_schema.sql) — applied locally |
| Types | [src/lib/radio-types.ts](../src/lib/radio-types.ts) |
| Real-time collab | Liveblocks (managed Yjs) — adopt when needed in Phase 2/6, not Phase 1 |
| AI providers | ElevenLabs + Anthropic Claude — deferred to Phase 4 |
| Multi-station | Schema is ready (`station_id` on every table); UI is single-station until #2 station signs up |
| Streaming engine | Liquidsoap / AzuraCast sidecar — deferred to Phase 3 |
| RTL peer dep | `@testing-library/dom@^10.4.1` installed |
| Design tokens | 4 elevation levels + CB-safe Okabe-Ito accent live in [globals.css](../src/app/globals.css) + [tailwind.config.ts](../tailwind.config.ts) |

---

## 5. Decisions still needed (block Phase 1 start)

| # | Decision | Recommendation |
|---|---|---|
| D1 | Default org + station seed for dev? | Yes — add a `migrations/0005_default_org_station.sql` that inserts one org + one station for the demo user, OR seed via D1 console. Recommended: migration file (reversible). |
| D2 | Track ingestion path for Phase 1 | Pipe existing `/api/upload` to also insert a `radio_tracks` row in the user's default station. Keep the legacy `tracks` table writes for back-compat. |
| D3 | Library URL structure | Current: `/app/library/{tracks,albums,artists,playlists}`. Recommend: keep as-is, replace internals. |
| D4 | Pagination strategy | Server-side cursor pagination via `keyset` (`played_at`, `id`) — D1 has no native window functions; offset is slow at scale. |
| D5 | Search backend | Phase 1: `LIKE` queries on `radio_tracks.title` / `artist`. Phase 2+: SQLite FTS5 virtual table or upstream search service. |

Ask the user before starting if any of these need pinning.

---

## 6. Agent fleet plan for Phase 1 first sprint

**Wave 3 — Phase 1 foundation (4 parallel agents):**

| Agent | Files (allowed) | Scope | R-tier |
|---|---|---|---|
| **P1-α** Default-org migration | `migrations/0005_default_org_station.sql` (NEW), tests in a new SQL-harness or via D1 query check | Insert one org `default`, one station `urban-radio`, seed `station_members` row for demo user | R1 |
| **P1-β** Real catalog API rewrite | `functions/api/catalog/{albums,artists,playlists,tracks}.ts`, `functions/api/catalog/{albums,artists,playlists}/[id].ts`, `functions/_lib/catalog-map.ts` | Query D1 `radio_tracks` joined to `categories` for the requesting user's station; respect cursor pagination; return shape compatible with `src/lib/types.ts` | R1 |
| **P1-γ** Upload pipeline extension | `functions/api/upload.ts`, `functions/_lib/upload-helpers.ts` (NEW if needed) | After R2 upload, also INSERT into `radio_tracks` with station_id from session; set default category, content_hash, duration_ms | R1 |
| **P1-δ** Library S1 screen rebuild | `src/views/app/TracksPage.tsx` (REWRITE), `src/components/library/VirtualizedTrackTable.tsx` (NEW), `src/components/library/FacetedFilterBar.tsx` (NEW), `src/components/library/TrackPreviewPane.tsx` (NEW) | Virtualized table (TanStack Table + react-virtual), faceted filter chips (genre / category / BPM / era), bulk-select column, hover preview with WaveSurfer.js waveform, "every metadata is a link" Roon pattern | R2 |

**Dependencies:**
- P1-δ depends on P1-β (consumes the new API)
- P1-γ depends on P1-α (needs default station to exist)
- P1-α + P1-β can run truly in parallel
- P1-γ can start in parallel with P1-α once both have brief read

Recommended order: **spawn P1-α + P1-β in parallel; once they return, spawn P1-γ + P1-δ in parallel**. Two waves of 2 instead of one wave of 4 to keep the dependency chain clean.

---

## 7. TDD plan — first 12 tests to write (RED first)

Per workrules §1:

| # | Test name | File |
|---|---|---|
| 1 | `default-org migration > given fresh D1 > creates one org row` | `migrations/0005_default_org_station.test.ts` (new harness) |
| 2 | `default-org migration > given fresh D1 > creates station 'urban-radio'` | same |
| 3 | `default-org migration > given existing demo user > links as station_member with role=admin` | same |
| 4 | `GET /api/catalog/tracks > given empty radio_tracks > returns []` | `functions/api/catalog/tracks.test.ts` (new) |
| 5 | `GET /api/catalog/tracks > given 3 tracks in user station > returns 3` | same |
| 6 | `GET /api/catalog/tracks > given station_id not in member list > returns 403` | same |
| 7 | `GET /api/catalog/tracks?cursor=X > respects keyset pagination` | same |
| 8 | `POST /api/upload > given file + auth > creates radio_tracks row in user station` | `functions/api/upload.test.ts` (new) |
| 9 | `POST /api/upload > given missing auth > returns 401 without writing R2` | same |
| 10 | `VirtualizedTrackTable > given 10000 rows > only renders visible window` | `src/components/library/VirtualizedTrackTable.test.tsx` (new) |
| 11 | `FacetedFilterBar > given genre filter selected > calls onFilterChange with genre param` | `src/components/library/FacetedFilterBar.test.tsx` (new) |
| 12 | `TracksPage > given empty API response > renders EmptyState (no mock fallback)` | `src/views/app/TracksPage.test.tsx` (extend if exists, new otherwise) |

Watch each go RED → GREEN. Commit at green only.

---

## 8. Exit criteria for Phase 1 first sprint

- Migration 0005 applied locally, idempotent (rerun = no-op).
- API endpoints return real D1 data scoped by `station_member.station_id`.
- Upload pipeline writes to `radio_tracks` end-to-end.
- New `/app/library/tracks` screen handles 100k synthetic rows at ≥ 30fps scroll (TanStack Virtual is the standard).
- Faceted filter chips work for genre, category, BPM range, era.
- Hover preview pane shows waveform + "appears on X clocks" placeholder.
- Cmd+K palette already navigates here (W1-δ shipped that).
- `npx vitest run` ≥ 186 tests, all pass.
- `npm run lint` 0 errors / 0 warnings.
- `npm run build` clean.
- `npm run test:e2e` 12+ pass (existing 12 + at least 2 new specs for library load + filter).

---

## 9. Out-of-scope for Phase 1 (DO NOT do)

- Hour Clock Builder (Phase 2)
- Real Icecast/Shoutcast output (Phase 3)
- Voice tracking (Phase 4)
- Royalty reports (Phase 5)
- Liveblocks presence (Phase 6)
- Settings rewrite (Phase 7)
- Migrating existing `tracks` table data into `radio_tracks` — back-compat read-only is fine; mutation goes only to new table

---

## 10. Pre-flight checklist (run before spawning Wave 3)

```bash
# Pull and verify clean baseline
npx vitest run                              # must be 174/174
npm run lint                                # must be 0 errors
rm -rf .next && npm run build               # must be green

# Verify D1 schema is live
./node_modules/.bin/wrangler d1 execute sonic-bloom-db --local \
  --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
# Must include: radio_tracks, clocks, clock_slots, schedule_assignments, play_log, voice_tracks, audit_log, organizations, stations, station_members, categories

# Boot dev server
npm run dev                                 # confirm port 3000 serves
```

If any check fails, **stop**. Re-read this session's transcript (search for "synthesis verify") to recover state before spawning agents.

---

## 11. Agent prompts template (paste into Phase 1 launch)

Use the same scaffold as Wave 1/2 — strict file allocation, R-tier, TDD steps with explicit test names, exit criteria, lint+build verification.

Reference prompts from this session's history (search "W1-α" or "W2-β" in transcript) for tone + structure. Key reminders:
- Each prompt is self-contained — agents don't see the conversation.
- Allowed-files list is a hard contract.
- Tests RED → GREEN → refactor.
- Agent reports back with: files changed, test count delta, lint/build status, deviations + reasons.
- Run multiple agents truly in parallel via `run_in_background: true`.

---

*This brief is a working document. Edit by PR; do not silently edit.*
