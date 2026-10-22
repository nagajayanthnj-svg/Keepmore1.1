import { expect, test } from '@playwright/test';

// T-404. Needs the demo data and demo disputes (CI seeds them). PP-DEMO-0003 was won with no refund.

test('refunded, fees and retained are shown separately, each with its source', async ({ page }) => {
  await page.goto('/outcome/PP-DEMO-0003');
  await expect(page.getByRole('heading', { name: 'Outcome for PP-DEMO-0003', level: 1 })).toBeVisible();
  await expect(page.getByTestId('outcome-kind')).toHaveAttribute('data-kind', 'WON');
  await expect(page.getByTestId('outcome-refunded-amount')).toHaveText('None');
  await expect(page.getByTestId('outcome-fees-amount')).toHaveText('None');
  await expect(page.getByTestId('outcome-retained-amount')).toHaveText(/^\d+\.\d\d USD$/);
  await expect(page.getByTestId('outcome-retained').locator('[data-truth-state="Simulated demo"]')).toBeVisible();
  await expect(page.getByTestId('outcome-lines').getByRole('row')).toHaveCount(2); // header + the retained line
  await expect(page.getByText('No net cost is worked out')).toBeVisible();
});

test('the ledger change is visible from the order', async ({ page }) => {
  await page.goto('/outcome/PP-DEMO-0003');
  const amount = (await page.getByTestId('outcome-retained-amount').textContent())!.replace(' USD', '');
  await page.getByTestId('outcome-order-link').click();
  await expect(page).toHaveURL(/\/orders\/DEMO-ORD-\d{4}\?case=/);
  const retained = page.getByTestId('order-lines').locator('[data-type="RETAINED"]');
  await expect(retained).toContainText(amount);
  await expect(retained).toContainText('PP-DEMO-0003');
  await expect(retained.locator('[data-truth-state="Simulated demo"]')).toBeVisible();
});

test('an open dispute says it is not decided yet', async ({ page }) => {
  await page.goto('/outcome/PP-DEMO-0001');
  await expect(page.getByTestId('outcome-open')).toContainText('Not decided yet');
});
