import { expect, test } from '@playwright/test';

// Needs the demo data and demo disputes (CI seeds them): three PP-DEMO cases.
test('the inbox lists the demo disputes, earliest deadline first, with a stale badge', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && m.text().includes('AG Grid')) errors.push(m.text().slice(0, 200));
  });
  await page.goto('/disputes');
  await expect(page.getByRole('heading', { name: 'Disputes', level: 1 })).toBeVisible();
  const grid = page.getByTestId('inbox-grid');
  await expect(grid.getByRole('row')).toHaveCount(4); // header + 3 cases

  const ids = await grid.locator('[col-id="dispute"] a').allTextContents();
  expect(ids).toEqual(['PP-DEMO-0001', 'PP-DEMO-0002', 'PP-DEMO-0003']);
  await expect(grid.locator('[data-sync-state="STALE"]').first()).toHaveText('Stale');
  // Two cases are always stale; the third is fresh only in the first five minutes after seeding.
  expect(await grid.locator('[data-sync-state="STALE"]').count()).toBeGreaterThanOrEqual(2);
  await expect(grid.locator('[data-sync-state]')).toHaveCount(3);
  await expect(grid.locator('[data-truth-state="Simulated demo"]')).toHaveCount(3);

  const deadlines = await grid.locator('[col-id="deadline"]').allTextContents();
  expect(deadlines.slice(1, 2)[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC/);
  expect(errors).toEqual([]);
});

test('a dispute link opens its screen with the order carried over', async ({ page }) => {
  await page.goto('/disputes');
  await page.getByTestId('inbox-grid').getByRole('link', { name: 'PP-DEMO-0001' }).click();
  await expect(page).toHaveURL(/\/disputes\/[A-Za-z0-9_-]+\?order=[A-Za-z0-9_-]+$/);
  await expect(page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Order' })).toBeVisible();
});

test('the Dispute tab opens the inbox when no case is chosen', async ({ page }) => {
  await page.goto('/overview');
  await page.getByRole('navigation', { name: 'Screens' }).getByRole('link', { name: 'Dispute' }).click();
  await expect(page).toHaveURL(/\/disputes$/);
});

test('the inbox API returns the same cases and no PayPal fields', async ({ request }) => {
  const res = await request.get('/api/disputes');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { rows: { disputeId: string }[] };
  expect(body.rows.map((r) => r.disputeId)).toEqual(['PP-DEMO-0001', 'PP-DEMO-0002', 'PP-DEMO-0003']);
  expect(JSON.stringify(body)).not.toContain('@');
});
