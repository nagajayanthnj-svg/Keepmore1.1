import { expect, test } from '@playwright/test';

const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Screens' });

test('visits all four screens, each with its heading and the current screen marked', async ({ page }) => {
  const visits: [string, string, string, number][] = [
    ['/overview', 'Overview', 'Overview', 2], // Order and Outcome need ids, so they are not links yet; Dispute opens the inbox
    ['/orders/ORD1?case=CASE1', 'Order', 'Order ORD1', 4],
    ['/disputes/CASE1?order=ORD1', 'Dispute', 'Dispute CASE1', 4],
    ['/outcome/CASE1?order=ORD1', 'Outcome', 'Outcome for CASE1', 4],
  ];
  for (const [url, current, heading, links] of visits) {
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
    await expect(nav(page).locator('a[aria-current="page"]')).toHaveText(current);
    await expect(nav(page).getByRole('link')).toHaveCount(links);
  }
});

test('navigation keeps the order and case context across screens, in order', async ({ page }) => {
  await page.goto('/orders/ORD1?case=CASE1');
  await expect(nav(page).getByRole('listitem')).toHaveText(['Overview', 'Order', 'Dispute', 'Outcome']);
  await nav(page).getByRole('link', { name: 'Dispute' }).click();
  await expect(page).toHaveURL(/\/disputes\/CASE1\?order=ORD1$/);
  await nav(page).getByRole('link', { name: 'Outcome' }).click();
  await expect(page).toHaveURL(/\/outcome\/CASE1\?order=ORD1$/);
  await nav(page).getByRole('link', { name: 'Overview' }).click();
  await expect(page).toHaveURL(/\/overview\?order=ORD1&case=CASE1$/);
  await nav(page).getByRole('link', { name: 'Order' }).click();
  await expect(page).toHaveURL(/\/orders\/ORD1\?case=CASE1$/);
});

test('screens that need an id are not links until it is known', async ({ page }) => {
  await page.goto('/overview');
  for (const name of ['Order', 'Outcome']) {
    await expect(nav(page).getByText(name, { exact: true })).toHaveAttribute('aria-disabled', 'true');
  }
});

test('overview shows all seven truth-state labels with what each means', async ({ page }) => {
  await page.goto('/overview');
  const legend = page.getByRole('region', { name: 'What the labels mean' });
  for (const label of [
    'Verified by PayPal',
    'Calculated',
    'Seller entered',
    'Estimated',
    'Illustrative',
    'Unknown',
    'Simulated demo',
  ]) {
    await expect(legend.locator(`[data-truth-state="${label}"]`)).toHaveCount(1);
  }
  await expect(legend.locator('[data-truth-state]')).toHaveCount(7);
});

test('a hostile id in the URL is not used in a link', async ({ page }) => {
  await page.goto('/overview?order=%3Cscript%3E&case=CASE1');
  await expect(nav(page).getByRole('link', { name: 'Dispute' })).toHaveAttribute('href', '/disputes/CASE1');
  await expect(nav(page).getByText('Order', { exact: true })).toHaveAttribute('aria-disabled', 'true');
});

// Needs the demo data: CI runs `npm run db:migrate` and `npm run db:seed` before e2e.
test('overview shows the seeded ledger totals in a grid, each row with one label, sources kept apart', async ({
  page,
}) => {
  await page.goto('/overview');
  await expect(page.getByTestId('orders-demo')).toHaveText('400');
  const grid = page.getByTestId('totals');
  for (const [type, currency, name, symbol] of [
    ['GROSS', 'USD', 'Sales (gross)', '$'],
    ['PAYPAL_FEE', 'USD', 'PayPal fees', '$'],
    ['FX', 'INR', 'Exchange-rate cost', '₹'],
  ] as const) {
    const row = grid.locator(`[role="row"][row-id="${type}|DEMO_SEEDED|${currency}"]`);
    await expect(row).toHaveCount(1);
    await expect(row.locator('[col-id="type"]')).toHaveText(name);
    await expect(row.locator('[data-truth-state="Simulated demo"]')).toHaveCount(1); // exactly one label per row
    await expect(row.locator('[data-truth-state]')).toHaveCount(1);
    await expect(row.locator('[col-id="totalMinor"]')).toContainText(symbol);
  }
});

test('overview grid logs no AG Grid errors, so every feature it uses has its module', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && m.text().includes('AG Grid')) problems.push(m.text().slice(0, 200));
  });
  await page.goto('/overview');
  await expect(page.getByTestId('totals').locator('[role="row"][row-id]')).not.toHaveCount(0);
  expect(problems).toEqual([]);
});
