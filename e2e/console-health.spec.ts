import { expect, test } from '@playwright/test';

/**
 * Fails the build if the app logs console.error or throws during navigation.
 * Filters known non-actionable dev-only noise when needed.
 */
test.describe('Console health', () => {
  test('landing and app shell load without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      errors.push(`[pageerror] ${err.message}`);
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.goto('/app');
    await expect(page.locator('aside')).toBeVisible();

    expect(errors, errors.join('\n')).toEqual([]);
  });
});
