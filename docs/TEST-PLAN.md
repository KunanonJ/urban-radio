# Test plan — Sonic Bloom

This document describes how the app is tested: unit/integration (Vitest), end-to-end (Playwright), environments, and what is intentionally out of scope.

## Objectives

- **Regression safety**: queue reorder logic and UI shell behave as expected after changes.
- **Smoke coverage**: critical routes load without errors when auth is not forced.
- **Fast feedback**: unit tests run in CI without a browser; E2E runs against a dev server.

## Test levels

| Level | Tool | Location | Purpose |
|--------|------|----------|---------|
| Unit / integration | Vitest | `src/**/*.test.ts`, `src/**/*.test.tsx` | Pure logic, hooks, components in isolation (e.g. queue reorder, `moveQueueItem`). |
| End-to-end | Playwright | `e2e/*.spec.ts` | Real browser: landing, `/app`, queue page structure, DnD smoke. |

## Environments and configuration

| Variable / setting | Role |
|--------------------|------|
| `PLAYWRIGHT_BASE_URL` | Overrides default `http://localhost:3330` for E2E (isolated from `npm run dev` on 3000). |
| `PLAYWRIGHT_REUSE_SERVER` | If set, Playwright will not start `dev:e2e` and expects a server at `PLAYWRIGHT_BASE_URL`. |
| `NEXT_PUBLIC_REQUIRE_AUTH` | If `true`, app may redirect unauthenticated users; default E2E assumes auth is **not** required (see smoke test). |
| `webServer` in `playwright.config.ts` | Starts **`npm run dev:e2e`** (Next on port **3330**) so tests do not attach to whatever is already on 3000. |

**Prerequisites for E2E (local / CI):**

1. `npm install`
2. `npx playwright install chromium` (first time or after Playwright upgrade)

## Unit / integration tests (Vitest)

**Run:** `npm test` (node project — the CI gate) or `npm run test:ui` (jsdom project — best-effort, see note). `npm run test:all` runs both; `npm run test:watch` during development.

Vitest is split into two projects (`vitest.config.ts`). The **node** project (`npm test`) covers `src/server/**`, `src/db/**`, `functions/**`, and `scripts/**` — pure logic plus `pg-mem`, no DOM. This is the blocking gate. The **jsdom** project (`npm run test:ui`) covers `src/components/**`, `src/views/**`, `src/lib/**`, `src/hooks/**`, and `src/test/**`; it carries a known heap-OOM in the component suite, so it is best-effort and **not** in the `npm test` gate.

**Current focus areas:**

- **Queue reorder** (`src/lib/queue-reorder.test.ts`): `moveQueueItem`, drag constraints, shuffle-mode behavior. This and the other `src/lib/**` units run under the **jsdom** project (`npm run test:ui`). Component-level queue UI tests can be added under `src/components/**/*.test.tsx` when needed.
- **Other jsdom units** (`npm run test:ui`): `auth-store`, `playback-recovery`, `recently-added`, `spot-schedule-engine`, `utils`, plus `src/test/example.test.ts`.

**Conventions:**

- Prefer testing behavior (order of IDs, disabled controls) over implementation details.
- Mock data from `mock-data` / minimal `Track` objects as in existing tests.

## End-to-end tests (Playwright)

**Run:** `npm run test:e2e` (or `npm run test:e2e:ui` for interactive debugging).

**Config:** `playwright.config.ts` — Chromium, traces/screenshots on failure, `baseURL` from env or `http://localhost:3330`.

### Suites and cases

| File | Suite | Cases (summary) |
|------|--------|------------------|
| `e2e/smoke.spec.ts` | Smoke | Landing shows main heading; `/app` loads and shell (`aside`) is visible when auth is not required. |
| `e2e/queue.spec.ts` | Queue | Queue page shows heading + list; reorder hint visible; drag-handle count matches rows; pointer activation on first drag handle (DnD smoke). |
| `e2e/dashboard-gantt.spec.ts` | Dashboard Gantt | Home queue preview in Gantt mode exposes `queue-gantt-scroll` with overflow (vertical/horizontal) and accepts scroll. |

### Selectors

E2E uses stable `data-testid` where needed:

- `queue-page`, `queue-list`, `queue-reorder-hint`, `queue-drag-handle` (see `QueuePage.tsx`, `SortableQueueList.tsx`).
- `queue-gantt-scroll` — scrollable region for the dashboard queue Gantt timeline (`QueueGanttTimeline.tsx`).

Locale: queue title may be localized (e.g. Thai); tests scope headings to `queue-page` and `h1` level, not English copy only.

### Out of scope / future E2E

- Full drag-and-drop **order verification** after drop (flaky without careful waits; unit tests cover `moveQueueItem`).
- Real audio playback, OAuth, or API-backed flows until implemented.
- Authenticated flows when `NEXT_PUBLIC_REQUIRE_AUTH=true` (add storageState / login fixture later).

## CI recommendations

GitHub Actions runs **`.github/workflows/ci.yml`**. The blocking `verify` job spins up a `postgres:15-alpine` service (the migrated `/app` shell and `/api/catalog/*` call `getDb()`), then: `npm ci` → `npm audit --omit=dev --audit-level=high` → `tsc --noEmit` → **`npm run db:migrate`** (Drizzle migrations against the service Postgres) → install Chromium → **`npm run verify`** (lint, node unit tests, migration tests, E2E, production build). `DATABASE_URL` is set job-wide; `AUTH_JWT_SECRET` is intentionally left unset so the middleware's dev allow-through keeps the logged-out E2E specs green. A separate **`ui-tests`** job runs `npm run test:ui` (jsdom project) with `continue-on-error: true` due to the known component-suite OOM.

For other runners, mirror that order. On Linux, install browsers before E2E:

`npx playwright install --with-deps chromium`

Artifacts: workflow uploads Playwright report on failure (paths gitignored locally).

## Traceability (example)

| Requirement | Unit | E2E |
|-------------|------|-----|
| Reorder queue without breaking shuffle mode | `queue-reorder.test.ts` | — |
| Queue UI shows list and reorder affordance | — | `queue.spec.ts` |
| App shell reachable | — | `smoke.spec.ts` |

## Full verification (local or release)

**One command** (runs lint → node unit tests → migration tests → E2E → build):

```bash
npm run verify
```

Equivalent manual steps (all should exit 0):

| Step | Command | Expect |
|------|---------|--------|
| 1 | `npm run lint` | No ESLint errors |
| 2 | `npm test` | Node-project Vitest files green (the gate) |
| 3 | `npm run test:migrations` | Migration tests green (`migrations/**/*.test.ts`) |
| 4 | `npm run test:e2e` | All Playwright specs green (starts dev server via config; needs `DATABASE_URL`) |
| 5 | `npm run build` | Next.js production build succeeds |

## When something fails (recovery plan)

Use this table to narrow and fix failures without guessing.

| Failure | Likely cause | Fix direction |
|---------|----------------|---------------|
| **Lint** | New code style / unused imports | Run `npm run lint` and fix reported files; match existing ESLint config. |
| **Vitest** | Logic change, mock drift, or env | Open the failing `*.test.ts`; read the assertion and implementation; update test or code; re-run `npm test`. |
| **E2E: browser missing** | Playwright not installed on machine/CI | Run `npx playwright install chromium` (CI: `npx playwright install --with-deps chromium`). |
| **E2E: connection refused / timeout** | Wrong port or dev server not starting | E2E uses **3330** via `dev:e2e`; check `playwright.config.ts` `webServer` and `PLAYWRIGHT_BASE_URL`. |
| **E2E: element not found** | UI/copy change or missing `data-testid` | Prefer adding or updating `data-testid` in components; avoid hard-coding English copy if i18n is used. |
| **E2E: auth redirect** | `NEXT_PUBLIC_REQUIRE_AUTH=true` without session | Run E2E with auth disabled for smoke, or add a logged-in fixture / storage state (future work). |
| **Build** | Type error or Next/webpack issue | Run `npm run build` locally; fix TypeScript and import errors first. |

After fixes, re-run **`npm run verify`** until it passes.

## Maintenance

- After UI copy or layout changes, prefer updating `data-testid` and specs over brittle text selectors.
- When adding routes under `/app`, extend smoke or add a focused spec file in `e2e/`.
