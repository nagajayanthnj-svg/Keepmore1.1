import { expect, test } from '@playwright/test';

// T-401. Needs the demo data and demo disputes (CI seeds them) and the test-only AI fixture (playwright.config sets
// AI_PROVIDER=fixture and KEEPMORE_E2E=1). The fixture answers with one supported claim and one unverified claim
// ("signed for") that its draft rests on.

test('an unverified claim shows in the "not backed" column and not in the draft', async ({ page }) => {
  await page.goto('/disputes/PP-DEMO-0002');
  await expect(page.getByRole('heading', { name: 'Dispute PP-DEMO-0002', level: 1 })).toBeVisible();
  await expect(page.getByTestId('recommendation-source')).toHaveText(/AI suggestion, checked/, { timeout: 20_000 });
  await expect(page.getByTestId('recommended-action')).toHaveAttribute('data-action', 'SEND_MESSAGE');
  await expect(page.getByTestId('truth-unsupported')).toContainText('signed for');
  await expect(page.getByTestId('truth-supported')).toContainText('tracking number DEMO0000002IN');
  await expect(page.getByTestId('truth-supported')).not.toContainText('signed for');
  await expect(page.getByTestId('draft')).toBeVisible();
  await expect(page.getByTestId('draft')).not.toContainText(/signed/i);
  await expect(page.getByTestId('gate-reason')).toContainText('draft was held back');
});

test('the header and the evidence checklist say what PayPal asked for and what is missing', async ({ page }) => {
  await page.goto('/disputes/PP-DEMO-0001');
  await expect(page.getByTestId('stage')).toHaveText('CHARGEBACK');
  await expect(page.getByTestId('case-header').locator('[data-truth-state="Simulated demo"]')).toBeVisible();
  await expect(page.getByTestId('deadline')).toHaveText(/Respond by .* IST/);
  const list = page.getByTestId('evidence-checklist');
  await expect(list.locator('[data-supportable="true"]')).toContainText('Proof of shipping');
  await expect(list.locator('[data-supportable="false"]')).toContainText('Signed delivery');
  await expect(page.getByTestId('allowed-source')).toHaveAttribute('data-source', 'SIMULATED');
  await expect(page.getByTestId('allowed-actions')).toContainText('Send evidence');
});

test('the buyer words are shown as quoted, labelled data', async ({ page }) => {
  await page.goto('/disputes/PP-DEMO-0001');
  const said = page.getByTestId('buyer-said');
  await expect(said.locator('blockquote')).toContainText('has not arrived');
  await expect(said).toContainText('not proof');
});

test('an unknown dispute says so instead of failing', async ({ page }) => {
  await page.goto('/disputes/PP-R-AAA-10000000');
  await expect(page.getByRole('heading', { name: 'Dispute not found' })).toBeVisible();
});
