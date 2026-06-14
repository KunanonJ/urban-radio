# Accessibility Audit Report

**Date:** 2026-05-14
**Tool:** [jest-axe](https://github.com/nickcolley/jest-axe) (axe-core 4.10 under the hood)
**WCAG target:** 2.1 AA
**Scope:** 10 main page-level components rendered in jsdom via Vitest.

## Summary

| Metric | Count |
|---|---|
| Pages audited | 10 |
| Pages passing axe | 10 |
| Critical violations found | 4 distinct rules across 4 pages |
| Critical violations fixed | 2 (impacting all 4 page failures) |
| Issues deferred to follow-up | 4 categories (see below) |

All 10 pages now pass the page-level axe audit with the agreed-upon rule set
(see `src/test/a11y-helpers.ts` for the active configuration).

## Tooling

- `jest-axe` and `@types/jest-axe` are installed as devDependencies.
- A shared helper, `expectNoA11yViolations(container)`, lives in
  `src/test/a11y-helpers.ts`. It registers the `toHaveNoViolations` matcher
  on Vitest's `expect` and exposes a small `a11yRuleConfig` object so tests
  can opt in or out of specific rules.
- Helper tests live in `src/test/a11y-helpers.test.ts` (clean markup passes;
  `<img>` without `alt` is flagged as `image-alt`).
- Page-level audits live in `src/test/a11y-pages.test.tsx`. Each page mounts
  with deterministic mocks for TanStack hooks, Next router, sonner, and
  heavyweight subtrees (Tremor, recharts, audio graph, virtualized table).

### Rule configuration

Two rules are disabled by default:

| Rule | Why |
|---|---|
| `region` | Pages mount as island fragments in tests, not as full `<main>`-anchored documents. Suppressing this rule avoids false positives for every fragment. |
| `color-contrast` | jsdom does not compute layout / computed styles, so axe cannot evaluate contrast deterministically. Manual contrast checks against the cb-safe accent palette live outside this suite. |

Both can be re-enabled per-test by overriding the second argument to
`expectNoA11yViolations`.

## Pages audited

| Page | Result | Notes |
|---|---|---|
| `LandingPage` | pass | Marketing surface, no interactive forms. |
| `LoginPage` | pass | Username/password labels are wired via `htmlFor` and `id`. Error message uses `role="alert"`. |
| `TracksPage` | pass (after fix) | Heading order was the only issue (`<h1>` → `<h3>` inside EmptyState). |
| `ClocksPage` | pass (after fix) | Same heading-order issue via EmptyState. |
| `SchedulePage` | pass (after fix) | Same heading-order issue via EmptyState. |
| `LiveStudioPage` | pass | LayoutPicker uses `role="group"` + `aria-label`. Audio-error banner uses `role="alert"`. |
| `VoiceTracksPage` | pass (after fix) | Radix Select trigger needed an explicit `aria-label`. |
| `ReportsPage` | pass | Tabs are Radix `Tabs`, which provides correct ARIA roles. |
| `AuditLogPage` | pass | Heavy subtrees (filters, list) are stubbed; shell passes cleanly. |
| `SettingsPage` | pass | Left rail + section content slot. Heavy sections are stubbed. |

## Critical issues fixed in this audit

### 1. `heading-order` — EmptyState used `<h3>` instead of `<h2>`

**File:** `src/components/ui/empty-state.tsx:28`
**Affected pages:** TracksPage, ClocksPage, SchedulePage, CartPage (also fixes
several other pages that use EmptyState through ErrorState patterns).
**Fix:** Changed the EmptyState title from `<h3>` to `<h2>`. EmptyState renders
directly inside the page's `<h1>` shell, so `<h2>` is the correct next level.
Also added `aria-hidden="true"` to the decorative icon so screen readers do
not announce it before the heading.
**Test impact:** `src/views/app/CartPage.test.tsx` queried `'h3'` to find the
empty state; updated to query `'h2'` and added a comment pointing back to the
EmptyState change.

### 2. `button-name` — Radix Select trigger in VoiceTracksPage had no name

**File:** `src/views/app/VoiceTracksPage.tsx:131`
**Affected page:** VoiceTracksPage.
**Fix:** Added `aria-label={t('voiceTracks.filter.all')}` to the
`<SelectTrigger>` so the combobox button has a discernible name when the
filter sits at its default "all" state and no value text is rendered.
**Test impact:** None — `VoiceTracksPage.test.tsx` continues to pass.

## Deferred issues (tracked for follow-up)

The following are outside the scope of this audit and are intentionally
deferred. They are documented here so the next a11y pass has a starting
point.

1. **Color contrast (`color-contrast` rule)**
   The cb-safe accent palette is already shipped, but a programmatic contrast
   check against the actual rendered colors cannot run inside jsdom. A
   separate Playwright/axe pass against the real browser is recommended.

   _Update (2026-06):_ that real-browser pass now exists as `e2e/a11y.spec.ts`
   (using `@axe-core/playwright`, `wcag2a` + `wcag2aa` tags) and runs in the CI
   gate via `npm run test:e2e`. The `color-contrast` rule itself is still
   disabled there and tracked as an open finding (see the `TODO(a11y)` notes in
   that spec).

2. **Manual screen-reader pass (JAWS / NVDA / VoiceOver)**
   axe catches roughly 50% of a11y issues. Live screen-reader walkthroughs
   are needed for: live-region announcements during playback transitions,
   the assignment-conflict dialog flow on SchedulePage, and the
   recorder UI on VoiceTracksPage.

3. **Keyboard navigation pass for every interactive surface**
   Confirm tab order, focus traps in dialogs (Radix provides this, but it
   should be verified against AssignClockDialog and ConflictResolutionDialog),
   and that the LayoutPicker on LiveStudioPage works without a pointer.

4. **CI gate**
   Wiring a CI step that runs `npx vitest run --project=jsdom src/test/a11y-pages.test.tsx`
   as a hard gate is deferred to the deployment side. The jsdom suite (which
   includes these a11y tests, per `src/test/**` in `vitest.config.ts`) runs in
   CI only via the non-blocking `ui-tests` job (`npm run test:ui`,
   `continue-on-error: true` due to the known component-suite OOM) — it is NOT
   part of the blocking `npm test`/`npm run verify` gate, which runs only the
   `node` project. Turning the a11y check into a release blocker is the
   additional step.

   _Note (2026-06):_ the real-browser axe pass (`e2e/a11y.spec.ts`, see item 1
   above) has since landed and DOES run in the blocking gate
   (`npm run verify` → `npm run test:e2e`).

## Recommended next steps

- [x] Wire axe-core into the Playwright e2e suite so color-contrast can be
      evaluated in a real browser. _(Done 2026-06: `e2e/a11y.spec.ts` +
      `@axe-core/playwright`; `color-contrast` remains disabled there pending a
      contrast fix.)_
- [ ] Add focus-visible regression tests for keyboard-only navigation across
      Live Studio, Schedule, and Reports.
- [ ] Pair with a screen-reader user on the recorder + scheduler flows.
- [ ] Verify all icon-only buttons (sidebar toggles, table actions) carry an
      `aria-label`. axe missed nothing in this pass for the audited shells,
      but the heavy child components (audit log list, voice track list) are
      currently stubbed and have not been individually audited.
