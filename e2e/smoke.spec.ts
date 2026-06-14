import { expect, test } from '@playwright/test';

test.describe('Smoke', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('app shell loads when auth is not required', async ({ page }) => {
    await page.goto('/app');
    await expect(page).toHaveURL(/\/app\/?$/);
    await expect(page.locator('aside')).toBeVisible();
  });
});
