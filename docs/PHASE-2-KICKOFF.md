# Phase 2 — Kickoff Brief

**Audience:** the AI/human pair resuming this work next session. Read top-to-bottom; act from §6 onward.

**Last updated:** 2026-05-13 (end of Phase 1).

---

## 1. State of the codebase (verified at end of Phase 1)

| Check | Status |
|---|---|
| Vitest (main) | **274 / 274** (33 files) |
| Vitest (migrations) | **5 / 5** |
| Total tests | **279 / 279** |
| Lint | **0 errors, 0 warnings** |
| `next build` | clean compile, 25 static pages |
| Dev server | 13 routes return 200 |
| D1 migrations applied (local) | **0001 + 0002 + 0003 + 0004 + 0005** |
| `/api/catalog/*` | 8 station-scoped endpoints with keyset cursor pagination |
| `/api/upload` | Writes to `radio_tracks` with content-hash dedup before R2 put |
| Demo station seed | `default` org, `urban-radio` station, 5 categories, demo user as admin |

**Phase 0 + Wave 1 + Wave 2 + Wave 3** are complete. The Library S1 screen (`/app/library/tracks`) is rebuilt with TanStack Table + Virtual + faceted filters + preview pane + cursor-based infinite scroll.

---

## 2. Phase 2 goal — one sentence

Build **Hour Clock Builder** (Screen S2) and **Scheduler Grid** (Screen S3) end-to-end against the existing `clocks` / `clock_slots` / `schedule_assignments` tables, so an operator can define an hour template once, then drop it onto a weekly calendar and have it govern playout — making this the first time the app actually programs radio rather than just storing tracks.

---

## 3. Why these screens next

From the upgrade plan §4 build order:
> **Library → Hour Clock Builder → Scheduler → Live Studio → Cart Wall → Voice Tracking → Reports → Settings.**

The Library is the **input**. The Hour Clock Builder defines the **rules**. The Scheduler Grid wires those rules to **time**. Together they're the data side of automation — once they ship, Live Studio (Phase 3) becomes the consumer rather than a green-field build.

---

## 4. Decisions already locked (do NOT re-litigate)

| Decision | Locked answer |
|---|---|
| Backend | Cloudflare Pages Functions + D1 + R2 (Firebase rejected) |
| Auth + station resolution | `functions/_lib/require-station.ts` — already wired |
| Pure SQL builder pattern | `functions/_lib/catalog-queries.ts` style — keyset cursor + station-scoped |
| Cursor format | base64url JSON `{lastDate, lastId}` |
| Drag-and-drop | @dnd-kit (already in deps) |
| Table virtualization | @tanstack/react-table + react-virtual (already installed) |
| Forms / validation | react-hook-form + Zod (in deps) |
| Empty state | `@/components/ui/empty-state` |
| Theming | 4 elevation levels, CB-safe accent palette (Phase 1 W1-ε) |
| Cmd+K palette | already wired — Phase 2 just adds new actions |
| Test harness for migrations | `vitest.migrations.config.ts` + `npm run test:migrations` |
| Test harness for `functions/**` | included in main vitest via `vitest.config.ts` |
| Liveblocks / collab | **deferred to Phase 6** — Phase 2 ships single-user CRUD |
| Comment threads on slots | **deferred to Phase 6** |
| Multi-cursor presence | **deferred to Phase 6** |
| AI suggestions ("auto-fill clock") | **deferred to Phase 4** |
| Real audio rendering of a clock | **deferred to Phase 3 (Live Studio)** — Phase 2 ships "live preview" as text + duration math only |

---

## 5. Decisions still needed (block Phase 2 start — answer at session top)

| # | Decision | Recommendation |
|---|---|---|
| D6 | RRULE library | **`rrule@^2.8`** — battle-tested, supports `freq=`, `byday=`, `bymonthday=`, until/count. Alt: roll our own minimal parser for daily/weekdays/weekends only. Recommendation: install `rrule`. |
| D7 | Conflict resolution semantics on the scheduler grid (when an existing assignment overlaps a new one) | **`override` is default**, with toast offering `merge` (both fire — last write wins on a tie) or `split` (truncate the existing). Surface a confirmation dialog rather than silent overwrite. |
| D8 | Year heatmap (collapsed scheduler view) | **Defer to a Phase 2.5 polish task** — Phase 2 ships only the 7-day × 24-hour week grid. Heat-map is nice-to-have, not core. |
| D9 | Should the clock builder save on every drag/edit or only on explicit "Save"? | **Explicit Save** with a "dirty" indicator and undo-on-discard. Auto-save adds CRDT-like concerns that belong to Phase 6. |
| D10 | "Live preview playlist" depth in Phase 2 | **Show slot order + estimated durations + total clock length**. Defer "actual songs the rules would pick from the library" to Phase 2.5 — needs a rotation engine. |
| D11 | Surface `category_id` in the API JSON (Phase 1 follow-up) | **YES, ship in P2-α** — clock builder needs to pick categories per slot, so this becomes natural here. |

Ask the user to confirm D6–D11 before spawning Wave 4. The recommendations are sensible defaults — likely a single "go" confirms all six.

---

## 6. Agent fleet plan for Phase 2

**Wave 4a — Backend foundations (2 parallel agents):**

| Agent | Files allowed | Scope | R-tier |
|---|---|---|---|
| **P2-α** Clock CRUD API + JSON shape fix | `functions/api/clocks/index.ts` (NEW), `functions/api/clocks/[id].ts` (NEW), `functions/api/clocks/[id]/slots.ts` (NEW), `functions/_lib/clock-queries.ts` (NEW), `functions/_lib/clock-queries.test.ts` (NEW), `functions/api/clocks/index.test.ts` (NEW), `functions/_lib/catalog-map.ts` (MODIFY — add `category_id` to `radioTrackToJson`), `src/lib/types.ts` (MODIFY — add `Clock`, `ClockSlot`, `Category` interfaces if not already exposed from radio-types) | Full CRUD on `clocks` + `clock_slots` + reorder endpoint. Station-scoped via `requireStation`. Slot position uniqueness enforced. | R1 |
| **P2-β** Schedule CRUD API + RRULE integration | `functions/api/schedule/index.ts` (NEW), `functions/api/schedule/[id].ts` (NEW), `functions/_lib/schedule-queries.ts` (NEW), `functions/_lib/schedule-queries.test.ts` (NEW), `functions/api/schedule/index.test.ts` (NEW), `functions/_lib/rrule-validation.ts` (NEW, validates RRULE strings server-side via `rrule`), `package.json` (add `rrule@^2.8`) | Full CRUD on `schedule_assignments`. Validates `weekday` 0-6, `hour` 0-23. Conflict-detection helper returns overlapping rows. Does NOT auto-resolve — UI surfaces the choice. | R1 |

**Wave 4b — UI screens (2 parallel agents after 4a returns clean):**

| Agent | Files allowed | Scope | R-tier |
|---|---|---|---|
| **P2-γ** Hour Clock Builder UI (Screen S2) | `src/app/app/clocks/page.tsx` (NEW), `src/views/app/ClocksPage.tsx` (NEW — list of clocks), `src/views/app/ClockBuilderPage.tsx` (NEW — editor), `src/app/app/clocks/[id]/page.tsx` (NEW), `src/components/clocks/ClockSlotPalette.tsx` (NEW), `src/components/clocks/ClockCanvas.tsx` (NEW), `src/components/clocks/ClockLivePreview.tsx` (NEW), `src/lib/clock-queries.ts` (NEW — TanStack Query hooks), `src/components/CommandPalette.tsx` (MODIFY — add "Go to Clocks" action), `src/locales/en.json` + `th.json` (ADD `clocks.*` namespace). Tests for each new component. | Two routes: `/app/clocks` (list + create) and `/app/clocks/[id]` (builder). dnd-kit for slot reorder. Save = button; "dirty" indicator next to title. EmptyState when no clocks. | R2 |
| **P2-δ** Scheduler Grid UI (Screen S3) | `src/app/app/schedule/page.tsx` (NEW), `src/views/app/SchedulePage.tsx` (NEW), `src/components/schedule/WeekGrid.tsx` (NEW), `src/components/schedule/AssignClockDialog.tsx` (NEW), `src/components/schedule/ConflictResolutionDialog.tsx` (NEW), `src/components/schedule/RRuleEditor.tsx` (NEW), `src/lib/schedule-queries.ts` (NEW), `src/components/CommandPalette.tsx` (MODIFY — add "Go to Schedule"), `src/locales/{en,th}.json` (ADD `schedule.*` namespace). Tests for each. | 7-day × 24-hour grid. Drag clock from sidebar onto a cell → POSTs schedule assignment. Click occupied cell → edit / delete. Conflict dialog appears when overlapping. RRule editor inline. | R2 |

**Dependencies:**
- P2-γ depends on P2-α (consumes clock API)
- P2-δ depends on P2-β (consumes schedule API) and P2-α (must list available clocks to assign)
- Therefore: spawn 4a (P2-α + P2-β) first in parallel, then 4b (P2-γ + P2-δ) once both return clean.

**Conflict mitigation:**
- Both Wave 4b agents will touch `src/components/CommandPalette.tsx` and `src/locales/{en,th}.json`. Pre-stage i18n keys (`clocks.*` and `schedule.*` namespaces) and either (a) split CommandPalette edits between the agents with clear anchor strings, or (b) have one agent add both palette entries on behalf of the other. Easier path: the orchestrator (next session's main agent) pre-edits CommandPalette to register both actions before spawning.

---

## 7. TDD plan — first 18 tests to write (RED first)

| # | Test name | File |
|---|---|---|
| 1 | `buildClocksListQuery > given stationId > scopes WHERE` | `functions/_lib/clock-queries.test.ts` |
| 2 | `buildClockDetailQuery > given clockId + stationId > returns clock + slots joined` | same |
| 3 | `buildClockInsert > given new clock > produces INSERT` | same |
| 4 | `buildSlotInsert > given slot at position N > rejects duplicate (station,clock,position)` | same |
| 5 | `buildSlotsReorder > given new order > issues batched UPDATEs` | same |
| 6 | `GET /api/clocks > given no session > 401` | `functions/api/clocks/index.test.ts` |
| 7 | `GET /api/clocks > given valid session > returns station's clocks only` | same |
| 8 | `POST /api/clocks > given body > creates clock for user's station` | same |
| 9 | `POST /api/clocks/:id/slots > position duplicate > 409` | same |
| 10 | `buildScheduleAssignmentInsert > given valid weekday + hour > inserts row` | `functions/_lib/schedule-queries.test.ts` |
| 11 | `validateRRule > given "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" > returns ok` | `functions/_lib/rrule-validation.test.ts` |
| 12 | `validateRRule > given gibberish > returns error` | same |
| 13 | `findOverlappingAssignments > given weekday=1,hour=10 > returns existing rows on same slot` | `functions/_lib/schedule-queries.test.ts` |
| 14 | `ClockSlotPalette > given slot dragged onto canvas > onAdd called with slot type` | `src/components/clocks/ClockSlotPalette.test.tsx` |
| 15 | `ClockCanvas > given 3 slots > renders them in position order` | `src/components/clocks/ClockCanvas.test.tsx` |
| 16 | `ClockCanvas > given slot drop reorder > calls onReorder with from/to` | same |
| 17 | `WeekGrid > given 7 weekdays × 24 hours > renders 168 cells` | `src/components/schedule/WeekGrid.test.tsx` |
| 18 | `WeekGrid > given clock dropped on cell > calls onAssign with clock + weekday + hour` | same |

Each follows Red → Green → Refactor. Commit at green only.

---

## 8. Exit criteria for Phase 2

- All Wave 4a + 4b agents return green: lint 0, build green, vitest delta ≥ +60 tests.
- Total suite: ≥ 339 main + 5 migration.
- `POST /api/clocks` creates a clock; `GET /api/clocks` lists user's clocks; `POST /api/clocks/:id/slots` enforces uniqueness.
- `POST /api/schedule` creates an assignment; conflict detection returns the conflicting rows.
- `/app/clocks` renders a list of clocks + "New clock" CTA; `/app/clocks/[id]` lets you drag slots and save.
- `/app/schedule` renders a 7×24 week grid; you can drag a clock onto a cell and persist.
- Empty states (no clocks / no schedule) use `EmptyState`.
- Cmd+K palette has new actions: "Go to Clocks", "Go to Schedule".
- Manual smoke: create a clock with 3 slots, save it, drop it on Monday 09:00 in the scheduler, reload page, see it persists.
- `npm run verify` (lint + main vitest + migration vitest + e2e + build) passes.

---

## 9. Out-of-scope for Phase 2 (DO NOT do)

- Real audio playout from a clock (Phase 3 — Live Studio)
- Picking actual songs that match clock rules ("rotation engine") — Phase 2.5 polish
- Voice tracking inside a slot (Phase 4)
- Year-heatmap view (Phase 2.5 polish)
- Multi-cursor presence on the builder/scheduler (Phase 6)
- Comment threads anchored to slots (Phase 6)
- Royalty + reporting on scheduled hours (Phase 5)
- AI "auto-fill clock from a prompt" (Phase 4)

---

## 10. Pre-flight checklist (run before spawning Wave 4)

```bash
# Pull and verify clean baseline
npm test                                          # must be 274 main
npm run test:migrations                           # must be 5
npm run lint                                      # must be 0 errors
rm -rf .next && npm run build                     # must be green

# Verify D1 schema is live + seed exists
./node_modules/.bin/wrangler d1 execute sonic-bloom-db --local \
  --command="SELECT COUNT(*) AS c FROM organizations;"   # expect 1
./node_modules/.bin/wrangler d1 execute sonic-bloom-db --local \
  --command="SELECT COUNT(*) AS c FROM stations;"        # expect 1
./node_modules/.bin/wrangler d1 execute sonic-bloom-db --local \
  --command="SELECT COUNT(*) AS c FROM categories WHERE station_id='urban-radio';"   # expect 5
./node_modules/.bin/wrangler d1 execute sonic-bloom-db --local \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('clocks','clock_slots','schedule_assignments') ORDER BY name;"
# Must list all three

# Boot dev server
npm run dev                                       # confirm port 3000 serves
```

If any check fails, **stop**. Re-read the end of Phase 1 transcript and recover before spawning agents.

---

## 11. Agent prompt template

Use the same scaffold as Wave 3a/3b — read `docs/PHASE-1-KICKOFF.md` §11 and the actual Wave 3a/3b agent reports for tone. Key reminders:

- Each prompt is self-contained — agents don't see the conversation.
- Allowed-files list is a hard contract.
- Tests RED → GREEN → refactor.
- Agent reports back with: files changed, test count delta, lint/build status, deviations + reasons, rollback path.
- Run multiple agents truly in parallel via `run_in_background: true`.
- For R1 agents, demand an explicit rollback section in the report.

**Standard pre-spawn rituals** (orchestrator does these — don't ask the agents):
1. Pre-stage i18n keys in `en.json` + `th.json` so 4b agents don't collide on the locales files (mirror the Wave 2 pattern).
2. Pre-edit `CommandPalette.tsx` to register both new Cmd+K actions ("Go to Clocks", "Go to Schedule") — avoids the 4b race.
3. Confirm `rrule` is installed before spawning P2-β (or include `npm install rrule` in P2-β's prompt with `--save-exact`).

---

## 12. Tracked Phase 1 follow-ups to address opportunistically

Phase 2 work touches several of these — close them as you go:

- **`category_id` in API JSON** — P2-α includes this fix (radio_tracks already has the column, but `radioTrackToJson` doesn't emit it). The clock builder's category selector needs it.
- **`Track` type extensions** (`bpm`, `playCount`, `lastPlayedAt`) — P2-α may surface these in the JSON; if so, extend `src/lib/types.ts`.
- **`audit_log` pattern** — Phase 2 is a natural place to land a `functions/_lib/audit-log.ts` helper that wraps `INSERT INTO audit_log (...)` and use it for clock + schedule writes. **Decision needed: ship it now or later?** Recommendation: ship in P2-α as `audit-log.ts` + tests, then both P2-α/β use it.
- **i18n facet labels in FacetedFilterBar** — not Phase 2 scope; defer.
- **Unused `search.noResults` i18n key** — defer.
- **`SettingsPage` + `PlaylistGeneratorPage` mock imports** — defer; ship a real integrations API in Phase 7 (Settings polish).

---

*This brief is a working document. Edit by PR; do not silently edit.*
