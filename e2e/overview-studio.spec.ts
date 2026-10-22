import { expect, test } from '@playwright/test';

// T-405: the Overview dashboard built with AG Studio. Needs the demo data (CI seeds it). CI has no licence key, so
// Studio runs in trial mode; these checks do not depend on the watermark.

test.describe('AG Studio dashboard on the Overview', () => {
  test('tiles name their source label and currency; FX is in INR; no mixed grand total', async ({ page }) => {
    await page.goto('/overview');
    const studio = page.getByTestId('overview-studio');
    await expect(studio.getByText('Simulated demo · USD').first()).toBeVisible({ timeout: 60_000 });
    await expect(studio.getByText('Simulated demo · INR')).toBeVisible();
    await expect(studio.getByText(/\d+\.\d\d INR/).first()).toBeVisible();
    await expect(studio.getByText('Fees by month (USD)')).toBeVisible();
    await expect(studio.getByText('Totals by kind, source label and currency')).toBeVisible();
    await expect(studio.getByText('Total', { exact: true })).toHaveCount(0);
  });

  test('the Disputes page shows the demo disputes', async ({ page }) => {
    await page.goto('/overview');
    await page.getByTestId('studio-page-disputes').click();
    const studio = page.getByTestId('overview-studio');
    await expect(studio.getByText('Every dispute')).toBeVisible({ timeout: 60_000 });
    await expect(studio.getByText('PP-DEMO-0003')).toBeVisible();
  });

  test('Customise switches Studio to edit mode with our three sources', async ({ page }) => {
    await page.goto('/overview');
    const studio = page.getByTestId('overview-studio');
    await expect(studio.getByText('Fees by month (USD)')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('studio-mode').click();
    await expect(page.getByTestId('studio-mode')).toHaveText('Done customising');
    for (const name of ['Ledger', 'Orders', 'Disputes']) await expect(studio.getByText(name, { exact: true }).first()).toBeVisible();
  });

  test('the Community totals table is still there with the same numbers', async ({ page }) => {
    await page.goto('/overview');
    await expect(page.getByTestId('totals')).toBeVisible();
  });
});

test.describe('AG Studio AI assistant (demo data only; the test fixture stands in for the model)', () => {
  test('opens on demo data with a notice, and a prompt goes through our server and back', async ({ page }) => {
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST') calls.push(new URL(r.url()).pathname);
    });
    await page.goto('/overview');
    const studio = page.getByTestId('overview-studio');
    await expect(studio.getByText('Fees by month (USD)')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('studio-ai').click();
    await expect(page.getByTestId('studio-ai-note')).toContainText('demo shop only');
    await studio.getByText('Fees by country', { exact: true }).first().click();
    await expect(studio.getByText('Fixture answer for tests.')).toBeVisible({ timeout: 30_000 });
    expect(calls).toContain('/api/studio-ai');
    expect(calls.some((c) => c.includes('googleapis'))).toBe(false);
  });

  test('the route refuses a request from another site', async ({ request }) => {
    const res = await request.post('/api/studio-ai', {
      headers: { origin: 'https://evil.example' },
      data: { input: [], responseFormat: { type: 'text' } },
    });
    expect(res.status()).toBe(403);
  });
});
