import { expect, test } from '@playwright/test';

test('home page has the KeepMore title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('KeepMore');
});
