import { expect, test } from '@playwright/test';

test('the sync route refuses a bad id', async ({ request }) => {
  const bad = await request.post('/api/disputes/..%2Fx/sync');
  expect(bad.status()).toBe(400);
  expect(await bad.json()).toEqual({ error: 'BAD_DISPUTE_ID' });
});
