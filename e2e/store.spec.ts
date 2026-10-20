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

test('a failed capture shows the error code and PayPal debug id, never "Paid"', async ({ page }) => {
  await page.route('**/api/orders', (route) =>
    route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'PPORDER2' }) }),
  );
  await page.route('**/api/orders/PPORDER2/capture', (route) =>
    route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'PAYPAL_ERROR', debugId: 'dbg123' }),
    }),
  );
  await page.goto('/store');
  await page.getByLabel('Quantity of Blue pottery vase, large').fill('1');
  await page.getByRole('button', { name: 'Stub PayPal' }).click();
  const status = page.getByRole('status');
  await expect(status).toContainText('could not be completed');
  await expect(status).toContainText('PAYPAL_ERROR');
  await expect(status).toContainText('dbg123');
  await expect(status).not.toContainText('Paid');
});
