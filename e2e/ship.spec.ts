import { expect, test } from '@playwright/test';

// Needs the demo data (CI seeds it). A demo order is never sent to PayPal, so this runs offline:
// the shipment is saved locally and the order screen says so.
test('shipping a demo order saves the tracking locally and the order screen says "Local tracking only"', async ({
  page,
  request,
}) => {
  const res = await request.post('/api/orders/DEMO-ORD-0001/ship', {
    data: { carrier: 'India Post', trackingNo: 'ee 123-456 789 in' },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ outcome: 'LOCAL_ONLY', pushStatus: 'NOT_ATTEMPTED', reason: 'DEMO_ORDER' });

  await page.goto('/orders/DEMO-ORD-0001');
  const shipment = page.getByTestId('shipment');
  await expect(shipment.locator('[data-shipment-status="LOCAL_ONLY"]')).toHaveText('Local tracking only');
  await expect(shipment).toContainText('INDIA_POST');
  await expect(shipment).toContainText('EE123456789IN');
  await expect(shipment.locator('[data-truth-state="Seller entered"]')).toHaveCount(1); // the tracking details are the seller's
});

test('an order with no shipment shows no shipment section', async ({ page }) => {
  await page.goto('/orders/DEMO-ORD-0002');
  await expect(page.getByRole('heading', { name: 'Order DEMO-ORD-0002' })).toBeVisible();
  await expect(page.getByTestId('shipment')).toHaveCount(0);
});

test('a bad tracking number is refused with 400', async ({ request }) => {
  const res = await request.post('/api/orders/DEMO-ORD-0003/ship', {
    data: { carrier: 'India Post', trackingNo: '<b>' },
  });
  expect(res.status()).toBe(400);
});

test('an unknown order is 404', async ({ request }) => {
  const res = await request.post('/api/orders/NOPE/ship', {
    data: { carrier: 'India Post', trackingNo: 'EE123456789IN' },
  });
  expect(res.status()).toBe(404);
});
