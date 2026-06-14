/**
 * Playwright + @axe-core/playwright shared runner.
 *
 * The existing jest-axe suite in `src/test/a11y-pages.test.tsx` covers
 * structural a11y in jsdom (heading order, ARIA, button names, etc.).
 * This helper runs the same engine against the running app in a real browser
 * so layout-dependent rules — most importantly `color-contrast` — can be
 * evaluated, which jsdom cannot do.
 *
 * Companion: `e2e/a11y.spec.ts` (one test per page).
 */
import { type Page, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Options forwarded to AxeBuilder for a single audit run. */
export interface RunAxeOptions {
  /** WCAG levels to include. Default `['wcag2a', 'wcag2aa']` (WCAG 2.1 AA). */
  tags?: string[];
  /** Rule ids to disable (e.g. `'region'` when auditing inside a layout fragment). */
  disableRules?: string[];
  /** CSS selectors to scope axe to. */
  include?: string[];
  /** CSS selectors to exclude from analysis. */
  exclude?: string[];
}

/**
 * Runs axe-core against the current page and asserts there are no violations.
 *
 * On failure, the assertion message contains one line per violation with the
 * rule id, impact, description, and node count. Open the Playwright HTML
 * report for the full per-node details (`html` + `target`).
 */
export async function runAxe(page: Page, opts: RunAxeOptions = {}): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(opts.tags ?? ['wcag2a', 'wcag2aa']);
  // NOTE: `AxeBuilder.disableRules` resets `this.option.rules` to an empty
  // object on every call, so chained calls would clobber earlier disables.
  // Pass the whole list once.
  if (opts.disableRules && opts.disableRules.length > 0) {
    builder = builder.disableRules(opts.disableRules);
  }
  for (const sel of opts.include ?? []) builder = builder.include(sel);
  for (const sel of opts.exclude ?? []) builder = builder.exclude(sel);

  const results = await builder.analyze();

  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `[${v.id}] ${v.impact}: ${v.description} (${v.nodes.length} nodes)`)
      .join('\n');
    expect(results.violations, summary).toEqual([]);
  }
}
