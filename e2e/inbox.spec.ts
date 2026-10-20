import { expect, test, type Page } from '@playwright/test';

// Needs the demo data and demo disputes (CI seeds them): three PP-DEMO cases. A database that also holds
// real sandbox disputes (a developer's dev.db) has more rows, so every check looks at the PP-DEMO rows only.
const demoRows = (page: Page) =>
  page
    .getByTestId('inbox-grid')
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: /^PP-DEMO-/ }) });

test('the inbox lists the demo disputes, earliest deadline first, with a stale badge', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && m.text().includes('AG Grid')) errors.push(m.text().slice(0, 200));
  });
  await page.goto('/disputes');
  await expect(page.getByRole('heading', { name: 'Disputes', level: 1 })).toBeVisible();
  const rows = demoRows(page);
  await expect(rows).toHaveCount(3);

  // Among the demo cases: the open chargeback with a deadline, the open inquiry with none, the resolved one.
  const ids = await page.getByTestId('inbox-grid').locator('[col-id="dispute"] a').allTextContents();
  expect(ids.filter((i) => i.startsWith('PP-DEMO-'))).toEqual(['PP-DEMO-0001', 'PP-DEMO-0002', 'PP-DEMO-0003']);

  // Two demo cases are always stale; the third is fresh only in the first five minutes after seeding.
  expect(await rows.locator('[data-sync-state="STALE"]').count()).toBeGreaterThanOrEqual(2);
  await expect(rows.locator('[data-sync-state]')).toHaveCount(3);
  await expect(rows.locator('[data-truth-state="Simulated demo"]')).toHaveCount(3);
  await expect(rows.first().locator('[col-id="deadline"]')).toHaveText(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC/);
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

test('the inbox API returns the demo cases, in the same order, and no email', async ({ request }) => {
  const res = await request.get('/api/disputes');
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { rows: { disputeId: string }[] };
  expect(body.rows.map((r) => r.disputeId).filter((i) => i.startsWith('PP-DEMO-'))).toEqual([
    'PP-DEMO-0001',
    'PP-DEMO-0002',
    'PP-DEMO-0003',
  ]);
  expect(JSON.stringify(body)).not.toContain('@');
});

// F-55: a truth-state label cut off ("Verified by PayPl") is a label the seller cannot read.
for (const [name, path, grid] of [
  ['inbox', '/disputes', 'inbox-grid'],
  ['overview totals', '/overview', 'totals'],
] as const) {
  test(`${name} grid: no badge or cell text is clipped`, async ({ page }) => {
    await page.goto(path);
    const g = page.getByTestId(grid);
    await expect(g.locator('[role="row"][row-id]').first()).toBeVisible();
    const clipped = await g.evaluate((root) => {
      const out: string[] = [];
      for (const badge of root.querySelectorAll<HTMLElement>('[data-truth-state],[data-sync-state]')) {
        const cell = badge.closest('[role="gridcell"]');
        if (!cell) continue;
        const b = badge.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        if (b.right > c.right + 0.5 || b.left < c.left - 0.5) out.push(`badge: ${badge.textContent}`);
      }
      for (const cell of root.querySelectorAll<HTMLElement>('[role="gridcell"]')) {
        if (cell.scrollWidth > cell.clientWidth + 1) out.push(`cell: ${cell.textContent?.slice(0, 40)}`);
      }
      return out;
    });
    expect(clipped).toEqual([]);
  });
}
