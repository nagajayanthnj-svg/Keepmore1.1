import { describe, expect, it } from 'vitest';
import { normaliseStatus } from '../../src/normalise/carrier-status';
import { CARRIERS, type Carrier } from '../../src/normalise/tracking';

// Independent review of T-106 normaliseStatus: text that must never read as delivered.
// A false DELIVERED is the worst error here: it would back a claim the parcel arrived.

const DELIVERED_STATES = ['DELIVERED', 'DELIVERED_TO_NEIGHBOUR'];

// Shared by every carrier: negations, attempts, returns, case, unicode apostrophes and NBSP.
const COMMON = [
  'Not delivered',
  'NOT DELIVERED',
  'Undelivered',
  'Delivery attempted',
  'Delivery attempted - no one available',
  'Delivery attempted – customer not available',
  'Returned after delivery',
  'Returned to sender after delivery attempt',
  'Couldn’t be delivered',
  "Couldn't be delivered",
  'Wasn’t delivered',
  'Not delivered',
  'Not Yet Delivered',
  'Delivery failed',
  'Delivery refused by recipient',
  'Delivered? No',
  'Will be delivered tomorrow',
  'To be delivered',
  'Scheduled for delivery',
  'Awaiting delivery',
  'Delivery rescheduled',
  'Delivered to wrong address - returned',
  'dElIvErY aTtEmPtEd',
  'Not delivered.',
  'Undeliverable as addressed',
  'Delivery cancelled',
  'Delivered status reversed',
  'Pending delivery',
  'Delivered… not',
  'Never delivered',
];

// Phrased the way each carrier writes its events.
const BY_CARRIER: Record<Exclude<Carrier, 'OTHER'>, string[]> = {
  INDIA_POST: [
    'Item not delivered',
    'Item Not Delivered',
    'Item delivery attempted',
    'Item Delivery Attempted - Addressee absent',
    'Item returned after delivery',
    'Item couldn’t be delivered',
    'ITEM UNDELIVERED',
    'Item delivered? no',
    'Item to be delivered',
    'Item not delivered to neighbour',
  ],
  DHL: [
    'Delivery attempted - signed for by nobody',
    'Shipment not delivered',
    'DELIVERED - SIGNED FOR BY: NOT DELIVERED',
    'Delivered - Signed for by: returned to shipper',
    'Delivered - signed for by: delivery attempted, consignee not available',
    'Delivered - Signed for by: refused',
    'Not delivered - signed for by nobody',
    'Shipment delayed - delivery attempted',
    'With delivery courier – not delivered',
    'Returned to shipper after delivery attempt',
  ],
  FEDEX: [
    'Not on FedEx vehicle for delivery',
    'Delivery exception - not delivered',
    'Delivered to FedEx location for pickup? No',
    'Delivery attempted - no access to delivery location',
    'Shipment exception – returned after delivery attempt',
    'Not Delivered',
    'Returning package to shipper after delivery attempt',
    'Delivered-not',
    'Undelivered',
    'Delivery Exception: Customer Not Available Or Business Closed',
  ],
  DEMO: [
    'not delivered to neighbour',
    'Not delivered to neighbor',
    'delivered to neighbour? no',
    'returned to sender after delivery',
    'out for delivery - not delivered',
    'in transit, not delivered',
    'DELIVERED TO NEIGHBOUR REFUSED',
    'delivery attempted',
    'exception: not delivered',
    'neighbour refused delivery',
  ],
};

describe('review: normaliseStatus never reads non-delivery text as delivered', () => {
  for (const carrier of CARRIERS) {
    const texts = carrier === 'OTHER' ? COMMON : [...COMMON, ...BY_CARRIER[carrier]];

    it(`${carrier} has at least 30 cases`, () => {
      expect(texts.length).toBeGreaterThanOrEqual(30);
    });

    it.each(texts)(`${carrier}: %j`, (text) => {
      expect(DELIVERED_STATES).not.toContain(normaliseStatus(carrier, text));
    });
  }

  it('OTHER is UNKNOWN for every case of every carrier', () => {
    for (const text of [...COMMON, ...Object.values(BY_CARRIER).flat()]) {
      expect(normaliseStatus('OTHER', text)).toBe('UNKNOWN');
    }
  });
});
