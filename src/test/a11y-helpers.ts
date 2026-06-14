/**
 * Accessibility test helpers built on top of jest-axe (axe-core).
 *
 * Usage:
 *
 *   import { expectNoA11yViolations } from '@/test/a11y-helpers';
 *
 *   // ...render a component and grab the container...
 *   await expectNoA11yViolations(container);
 *
 * The helper extends Vitest's `expect` with the `toHaveNoViolations` matcher
 * the first time it is imported, so it is safe to import multiple times.
 */
import { axe, toHaveNoViolations } from 'jest-axe';
import { expect } from 'vitest';

/**
 * Minimal local copy of the parts of axe-core's `RunOptions` we use here.
 *
 * axe-core ships its types as a `declare namespace axe { … }` ambient
 * module — they are not directly importable as named exports, and the
 * `@types/jest-axe` package only re-exports through that namespace. Rather
 * than reaching into the ambient namespace we declare the shape we need
 * locally; it is intentionally tiny.
 */
interface RunOptions {
  rules?: Record<string, { enabled: boolean }>;
}

// jest-axe ships a matcher named `toHaveNoViolations`. Vitest's `expect.extend`
// accepts the same shape as Jest's, so this works as-is.
expect.extend(toHaveNoViolations);

/**
 * Default axe configuration for this app.
 *
 * - `region` is disabled because most pages mount as island fragments inside
 *   an app shell in tests (not as a full page with a `<main>` landmark), and
 *   axe would otherwise flag the missing region on every fragment.
 * - `color-contrast` is disabled in jsdom because jsdom does not compute
 *   layout/colors, so the rule produces false negatives/positives.
 *   Color contrast is verified separately via the cb-safe palette test
 *   (see docs/A11Y-REPORT.md).
 */
export const a11yRuleConfig: RunOptions = {
  rules: {
    region: { enabled: false },
    'color-contrast': { enabled: false },
  },
};

/**
 * Run axe-core against the given container and assert no violations.
 *
 * Throws an AssertionError listing the violations on failure, so it integrates
 * cleanly with Vitest's standard failure UI.
 */
export async function expectNoA11yViolations(
  container: HTMLElement,
  options: RunOptions = a11yRuleConfig,
): Promise<void> {
  const results = await axe(container, options);
  expect(results).toHaveNoViolations();
}
