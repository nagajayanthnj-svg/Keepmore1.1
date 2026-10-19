import { describe, expect, it } from 'vitest';
import { CANONICAL_STATUSES, normaliseStatus } from '../../src/normalise/carrier-status';
import { CARRIERS, normaliseCarrier, normaliseTracking } from '../../src/normalise/tracking';

describe('normaliseTracking', () => {
  it('uppercases and strips spaces and hyphens', () => {
    expect(normaliseTracking('ee 123-456 789 in')).toBe('EE123456789IN');
    expect(normaliseTracking('  EE123456789IN\n')).toBe('EE123456789IN');
    expect(normaliseTracking('1Z-999 AA1 0123 456 784')).toBe('1Z999AA10123456784');
  });

  it('is idempotent', () => {
    const once = normaliseTracking('ee 123-456 789 in');
    expect(normaliseTracking(once)).toBe(once);
  });

  it('keeps other characters, it does not guess', () => {
    expect(normaliseTracking('ab/12_3')).toBe('AB/12_3');
  });
});

describe('normaliseCarrier', () => {
  it('maps known spellings to canonical codes', () => {
    expect(normaliseCarrier('INDIA_POST')).toBe('INDIA_POST');
    expect(normaliseCarrier('India Post')).toBe('INDIA_POST');
    expect(normaliseCarrier('speed post')).toBe('INDIA_POST');
    expect(normaliseCarrier('DHL Express')).toBe('DHL');
    expect(normaliseCarrier('FedEx')).toBe('FEDEX');
    expect(normaliseCarrier('demo')).toBe('DEMO');
  });

  it('returns OTHER for anything unmapped', () => {
    expect(normaliseCarrier('Blue Dart')).toBe('OTHER');
    expect(normaliseCarrier('')).toBe('OTHER');
  });

  it('only returns members of CARRIERS', () => {
    for (const raw of ['India Post', 'dhl', 'fedex', 'demo', 'zzz']) {
      expect(CARRIERS).toContain(normaliseCarrier(raw));
    }
  });
});

describe('normaliseStatus', () => {
  it('maps the plan example', () => {
    expect(normaliseStatus('INDIA_POST', 'Item delivered to neighbour')).toBe('DELIVERED_TO_NEIGHBOUR');
  });

  it('ignores case, extra whitespace and trailing punctuation', () => {
    expect(normaliseStatus('INDIA_POST', '  ITEM   Delivered.  ')).toBe('DELIVERED');
  });

  it('maps India Post phrases', () => {
    expect(normaliseStatus('INDIA_POST', 'Item Booked')).toBe('IN_TRANSIT');
    expect(normaliseStatus('INDIA_POST', 'Item Dispatched')).toBe('IN_TRANSIT');
    expect(normaliseStatus('INDIA_POST', 'Item Out for Delivery')).toBe('OUT_FOR_DELIVERY');
    expect(normaliseStatus('INDIA_POST', 'Item Delivered')).toBe('DELIVERED');
    expect(normaliseStatus('INDIA_POST', 'Item Held at Customs')).toBe('HELD_AT_CUSTOMS');
    expect(normaliseStatus('INDIA_POST', 'Item Returned to Sender')).toBe('RETURNED');
    expect(normaliseStatus('INDIA_POST', 'Item Undelivered')).toBe('EXCEPTION');
  });

  it('maps DHL phrases, including a variable suffix', () => {
    expect(normaliseStatus('DHL', 'Shipment picked up')).toBe('IN_TRANSIT');
    expect(normaliseStatus('DHL', 'With delivery courier')).toBe('OUT_FOR_DELIVERY');
    expect(normaliseStatus('DHL', 'Delivered')).toBe('DELIVERED');
    expect(normaliseStatus('DHL', 'Delivered - Signed for by : A KUMAR')).toBe('DELIVERED');
    expect(normaliseStatus('DHL', 'Shipment on hold at customs')).toBe('HELD_AT_CUSTOMS');
  });

  it('maps FedEx phrases', () => {
    expect(normaliseStatus('FEDEX', 'In transit')).toBe('IN_TRANSIT');
    expect(normaliseStatus('FEDEX', 'On FedEx vehicle for delivery')).toBe('OUT_FOR_DELIVERY');
    expect(normaliseStatus('FEDEX', 'Delivered')).toBe('DELIVERED');
    expect(normaliseStatus('FEDEX', 'Delivery exception')).toBe('EXCEPTION');
  });

  it('maps the demo carrier phrases', () => {
    expect(normaliseStatus('DEMO', 'Delivered')).toBe('DELIVERED');
    expect(normaliseStatus('DEMO', 'In transit')).toBe('IN_TRANSIT');
    expect(normaliseStatus('DEMO', 'Delivered to neighbour')).toBe('DELIVERED_TO_NEIGHBOUR');
  });

  it('returns UNKNOWN for unmapped text, never a guess', () => {
    expect(normaliseStatus('INDIA_POST', 'Something we have never seen')).toBe('UNKNOWN');
    expect(normaliseStatus('DHL', '')).toBe('UNKNOWN');
    expect(normaliseStatus('FEDEX', '   ')).toBe('UNKNOWN');
  });

  it('never reads a negative as DELIVERED', () => {
    for (const text of ['Not delivered', 'Delivery attempted, not delivered', 'Undelivered']) {
      expect(normaliseStatus('INDIA_POST', text)).not.toBe('DELIVERED');
      expect(normaliseStatus('FEDEX', text)).not.toBe('DELIVERED');
    }
  });

  it('does not borrow another carrier table', () => {
    expect(normaliseStatus('OTHER', 'Delivered')).toBe('UNKNOWN');
    expect(normaliseStatus('DHL', 'Item Booked')).toBe('UNKNOWN');
  });

  it('only ever returns a canonical status', () => {
    for (const c of CARRIERS) {
      for (const t of ['Delivered', 'Item Booked', 'xyz']) {
        expect(CANONICAL_STATUSES).toContain(normaliseStatus(c, t));
      }
    }
  });
});
