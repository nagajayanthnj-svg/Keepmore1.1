import { describe, expect, it } from 'vitest';
import { claimText } from '../../src/ai/claim-text';

describe('claimText: a typed claim in plain words', () => {
  const r = ['REC-1'];
  it.each([
    [{ id: 'a', type: 'SHIPPED', carrier: 'INDIA_POST', trackingNo: 'EE1IN', date: '2026-09-22', recordIds: r }, 'Shipped on 2026-09-22 with India Post, tracking number EE1IN'],
    [{ id: 'a', type: 'DELIVERED', date: '2026-10-01', recordIds: r }, 'Tracking record shows delivered on 2026-10-01'],
    [{ id: 'a', type: 'DELIVERED_TO_NEIGHBOUR', date: '2026-10-01', recordIds: r }, 'Tracking record shows delivered to a neighbour on 2026-10-01'],
    [{ id: 'a', type: 'TRACKING_STATUS', status: 'HELD_AT_CUSTOMS', date: '2026-09-24', recordIds: r }, 'Tracking status held at customs on 2026-09-24'],
    [{ id: 'a', type: 'ORDER_AMOUNT', minor: 4500, currency: 'USD', recordIds: r }, 'Order total 45.00 USD'],
    [{ id: 'a', type: 'CAPTURE_AMOUNT', minor: 4500, currency: 'USD', recordIds: r }, 'PayPal captured 45.00 USD'],
    [{ id: 'a', type: 'ORDER_COUNTRY', country: 'GB', recordIds: r }, 'Shipping to GB'],
    [{ id: 'a', type: 'SELLER_PROTECTION', value: 'ELIGIBLE', recordIds: r }, 'Seller protection: eligible'],
    [{ id: 'a', type: 'BUYER_SAID', quote: 'not arrived', recordIds: r }, 'The buyer wrote: “not arrived”'],
    [{ id: 'a', type: 'UNTYPED', text: 'Signed for', recordIds: r }, 'Signed for'],
  ] as const)('%o', (claim, text) => expect(claimText(claim as never)).toBe(text));
});
