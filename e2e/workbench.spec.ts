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

// Part 2: actions, payload, approve and send.
const waitForActions = async (page: import('@playwright/test').Page) =>
  expect(page.getByTestId('allowed-source')).toBeVisible({ timeout: 20_000 });

test('only the actions PayPal offers are buttons, and nothing is chosen for the seller', async ({ page }) => {
  await page.goto('/disputes/PP-DEMO-0001');
  await waitForActions(page);
  const group = page.getByTestId('allowed-actions');
  await expect(group.getByRole('button')).toHaveCount(2);
  await expect(page.getByTestId('action-ACCEPT_CLAIM')).toBeVisible();
  await expect(page.getByTestId('action-PROVIDE_EVIDENCE')).toBeVisible();
  await expect(page.getByTestId('action-SEND_MESSAGE')).toHaveCount(0);
  await expect(page.getByTestId('action-ESCALATE')).toHaveCount(0);
  await expect(group.locator('[aria-pressed="true"]')).toHaveCount(0);
});

test('the exact payload is shown before approval, with only the evidence we can support', async ({ page }) => {
  await page.goto('/disputes/PP-DEMO-0001');
  await waitForActions(page);
  await page.getByTestId('action-PROVIDE_EVIDENCE').click();
  const payload = page.getByTestId('payload');
  await expect(payload).toContainText('"evidenceType": "PROOF_OF_FULFILLMENT"');
  await expect(payload).not.toContainText('SIGNATURE');
  await expect(payload).toContainText('DEMO0000001IN');
  await expect(page.getByTestId('send')).toBeDisabled();
  await page.getByTestId('approve').click();
  await expect(page.getByTestId('action-message')).toContainText('Nothing is sent to PayPal');
  await expect(page.getByTestId('send')).toBeDisabled();
});

test('accepting the claim needs the seller own words before it can be approved', async ({ page }) => {
  await page.goto('/disputes/PP-DEMO-0001');
  await waitForActions(page);
  await page.getByTestId('action-ACCEPT_CLAIM').click();
  await expect(page.getByTestId('payload')).toContainText('"acceptClaimType": "REFUND"');
  await expect(page.getByTestId('approve')).toBeDisabled();
  await page.getByTestId('payload-text').fill('Refunding in full as a goodwill gesture.');
  await expect(page.getByTestId('payload')).toContainText('goodwill gesture');
  await expect(page.getByTestId('approve')).toBeEnabled();
});

test('escalating needs an explicit "cannot be undone" tick', async ({ page }) => {
  await page.goto('/disputes/PP-DEMO-0002');
  await waitForActions(page);
  await page.getByTestId('action-ESCALATE').click();
  await page.getByTestId('payload-text').fill('Please review the tracking.');
  await expect(page.getByTestId('approve')).toBeDisabled();
  await page.getByTestId('escalate-understood').check();
  await expect(page.getByTestId('approve')).toBeEnabled();
});

test('the message starts from the checked draft; an edit is labelled Seller entered and changes the payload', async ({ page }) => {
  await page.goto('/disputes/PP-DEMO-0002');
  await waitForActions(page);
  await page.getByTestId('action-SEND_MESSAGE').click();
  await expect(page.getByTestId('payload-text')).toHaveValue(/DEMO0000002IN/);
  await expect(page.getByTestId('payload-text')).not.toHaveValue(/signed/i);
  await expect(page.getByTestId('edited-note')).toHaveCount(0);
  await page.getByTestId('payload-text').fill('Hello, we are checking with India Post.');
  await expect(page.getByTestId('edited-note').locator('[data-truth-state="Seller entered"]')).toBeVisible();
  await expect(page.getByTestId('payload')).toContainText('we are checking with India Post');
});

test('the sandbox settle step does not exist when DEMO_MODE is off (T-402)', async ({ page, request }) => {
  await page.goto('/disputes/PP-DEMO-0001');
  await waitForActions(page);
  await expect(page.getByTestId('sandbox-settle')).toHaveCount(0);
  const res = await request.post('/api/disputes/PP-R-AAA-10000000/sandbox-settle', {
    data: { outcome: 'SELLER_FAVOR', expectedRawHash: 'a'.repeat(64) },
  });
  expect(res.status()).toBe(404);
  expect((await request.post(`/api/approvals/${'c'.repeat(25)}/sandbox-settle`)).status()).toBe(404);
});
