import { expect, test } from '@playwright/test';

// No live PayPal in CI: the SDK script is replaced by a stub that draws one button and
// calls createOrder / onApprove the way the real buttons do.
const sdkStub = `
window.paypal = { Buttons: (o) => ({ render: async (el) => {
  const b = document.createElement('button'); b.textContent = 'Stub PayPal';
  b.onclick = async () => { try { await o.onClick({}, { resolve: async () => {}, reject: async () => { throw new Error('empty'); } });
    const id = await o.createOrder(); await o.onApprove({ orderID: id }); } catch (e) {} };
  el.appendChild(b); } }) };`;

test.beforeEach(async ({ page }) => {
  await page.route('**/sdk/js**', (route) => route.fulfill({ contentType: 'application/javascript', body: sdkStub }));
});

test('store lists the catalogue, totals the cart in dollars, and checks out through the API', async ({ page }) => {
  let sent: unknown;
  await page.route('**/api/orders', async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'PPORDER1' }) });
  });
  await page.route('**/api/orders/PPORDER1/capture', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        orderId: 'PPORDER1',
        captureId: 'CAP1',
        status: 'COMPLETED',
        grossMinor: 12000,
        currency: 'USD',
      }),
    }),
  );

  await page.goto('/store');
  await expect(page.locator('[data-sku]')).toHaveCount(8);
  await expect(page.getByTestId('cart-total')).toHaveText('$0.00');

  await page.getByLabel('Quantity of Blue pottery vase, large').fill('1');
  await page.getByLabel('Quantity of Hand-painted mug, set of 2').fill('2');
  await expect(page.getByTestId('cart-total')).toHaveText('$120.00');

  await page.getByRole('button', { name: 'Stub PayPal' }).click();
  await expect(page.getByRole('status')).toContainText('Paid $120.00');
  // The browser sends only SKUs and quantities, never an amount.
  expect(sent).toEqual({
    items: [
      { sku: 'BP1001', qty: 1 },
      { sku: 'BP1003', qty: 2 },
    ],
  });
});

test('an empty cart does not create an order', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/orders', (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto('/store');
  await page.getByRole('button', { name: 'Stub PayPal' }).click();
  await page.waitForTimeout(300);
  expect(calls).toBe(0);
});

test('loads the PayPal script once and draws exactly one button set', async ({ page }) => {
  let loads = 0;
  await page.unroute('**/sdk/js**');
  await page.route('**/sdk/js**', (route) => {
    loads += 1;
    return route.fulfill({ contentType: 'application/javascript', body: sdkStub });
  });
  await page.goto('/store');
  await expect(page.getByRole('button', { name: 'Stub PayPal' })).toHaveCount(1);
  await page.waitForTimeout(500);
  expect(loads).toBe(1);
});

test("shows PayPal's own reason when the buttons cannot be drawn", async ({ page }) => {
  await page.unroute('**/sdk/js**');
  await page.route('**/sdk/js**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.paypal = { Buttons: () => ({ render: async () => { throw new Error('Invalid client id for this environment'); } }) };`,
    }),
  );
  await page.goto('/store');
  const msg = page.locator('p[role="alert"]'); // Next adds its own hidden alert for route changes
  await expect(msg).toContainText('The PayPal buttons could not be shown');
  await expect(msg).toContainText('Invalid client id for this environment');
});
