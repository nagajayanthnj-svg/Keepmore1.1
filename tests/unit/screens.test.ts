import { describe, expect, it } from 'vitest';
import { contextFromLocation, screenLinks, SCREENS } from '../../src/lib/screens';

describe('contextFromLocation', () => {
  it('reads the order from /orders/[id] and the case from ?case', () => {
    expect(contextFromLocation('/orders/ORD1', new URLSearchParams('case=CASE1'))).toEqual({ orderId: 'ORD1', caseId: 'CASE1' });
  });
  it('reads the case from /disputes/[id] and /outcome/[id], and the order from ?order', () => {
    expect(contextFromLocation('/disputes/CASE1', new URLSearchParams('order=ORD1'))).toEqual({ orderId: 'ORD1', caseId: 'CASE1' });
    expect(contextFromLocation('/outcome/CASE1', new URLSearchParams('order=ORD1'))).toEqual({ orderId: 'ORD1', caseId: 'CASE1' });
  });
  it('is empty on the overview with no query', () => {
    expect(contextFromLocation('/overview', new URLSearchParams())).toEqual({});
  });
  it('keeps context given on the overview', () => {
    expect(contextFromLocation('/overview', new URLSearchParams('order=ORD1&case=CASE1'))).toEqual({ orderId: 'ORD1', caseId: 'CASE1' });
  });
  it('drops ids that are not plain ids', () => {
    expect(contextFromLocation('/orders/<script>', new URLSearchParams('case=../../x'))).toEqual({});
    expect(contextFromLocation('/overview', new URLSearchParams('order=' + 'a'.repeat(65)))).toEqual({});
  });
});

describe('screenLinks', () => {
  it('lists the four screens in order: Overview, Order, Dispute, Outcome', () => {
    expect(SCREENS.map((s) => s.key)).toEqual(['overview', 'order', 'dispute', 'outcome']);
  });
  it('links every screen and carries both ids', () => {
    const links = screenLinks({ orderId: 'ORD1', caseId: 'CASE1' });
    expect(links.map((l) => l.href)).toEqual([
      '/overview?order=ORD1&case=CASE1',
      '/orders/ORD1?case=CASE1',
      '/disputes/CASE1?order=ORD1',
      '/outcome/CASE1?order=ORD1',
    ]);
  });
  it('has no link for a screen whose id is not known yet', () => {
    expect(screenLinks({}).map((l) => l.href)).toEqual(['/overview', null, null, null]);
    expect(screenLinks({ orderId: 'ORD1' }).map((l) => l.href)).toEqual(['/overview?order=ORD1', '/orders/ORD1', null, null]);
    expect(screenLinks({ caseId: 'CASE1' }).map((l) => l.href)).toEqual(['/overview?case=CASE1', null, '/disputes/CASE1', '/outcome/CASE1']);
  });
  it('encodes ids it is given', () => {
    const l = screenLinks({ orderId: 'a-b_c', caseId: 'X1' });
    expect(l[1]!.href).toBe('/orders/a-b_c?case=X1');
  });
});
