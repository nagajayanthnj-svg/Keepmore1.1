import { expect, test } from '@playwright/test';

// T-406. Needs the demo data (CI seeds it).

test('each timeline line shows a source label, a time, a rate or formula, and a reference', async ({ page }) => {
  await page.goto('/orders/DEMO-ORD-0010');
  const lines = page.getByTestId('order-lines').locator('li');
  await expect(lines.first()).toBeVisible();
  const n = await lines.count();
  expect(n).toBeGreaterThanOrEqual(4);
  for (let i = 0; i < n; i++) {
    const l = lines.nth(i);
    await expect(l.locator('[data-truth-state]')).toHaveCount(1);
    await expect(l.locator('[data-time]')).toHaveText(/\d{4}-\d\d-\d\d \d\d:\d\d UTC|Time not recorded/);
    expect(((await l.locator('[data-formula]').textContent()) ?? '').length).toBeGreaterThan(5);
    expect(((await l.locator('[data-ref]').textContent()) ?? '').length).toBeGreaterThan(0);
  }
  await expect(page.getByTestId('order-lines').locator('[data-type="FX"] [data-formula]')).toHaveText(/× \d+\.\d{4} INR\/USD .* × 3% spread = \d+\.\d\d INR/);
});

test('leakage is listed line by line with labels, never as one total', async ({ page }) => {
  await page.goto('/orders/DEMO-ORD-0010');
  const leak = page.getByTestId('order-leakage');
  await expect(leak.locator('li')).toHaveCount(2);
  await expect(leak.locator('[data-type="PAYPAL_FEE"]')).toContainText('USD');
  await expect(leak.locator('[data-type="FX"]')).toContainText('INR');
  await expect(leak.locator('[data-truth-state]')).toHaveCount(2);
  await expect(leak.getByText(/total/i)).toHaveCount(1); // only the sentence saying they are not added into one total
});

test('the inbox link (our own order id) opens the same timeline', async ({ page }) => {
  await page.goto('/orders/demoord0010');
  await expect(page.getByRole('heading', { name: 'Order DEMO-ORD-0010', level: 1 })).toBeVisible();
});
