import { describe, expect, it } from 'vitest';
import { ageText, deadlineText, humanise, sortInbox, type InboxRow } from '../../src/disputes/inbox';

describe('ageText', () => {
  it.each([
    [-5, 'just now'],
    [0, 'just now'],
    [59, 'just now'],
    [60, '1 min ago'],
    [299, '4 min ago'],
    [3599, '59 min ago'],
    [3600, '1 h ago'],
    [86_399, '23 h ago'],
    [86_400, '1 d ago'],
    [3 * 86_400 + 5, '3 d ago'],
  ])('%j seconds -> %s', (s, want) => {
    expect(ageText(s)).toBe(want);
  });
});

describe('humanise: PayPal codes in plain words, never changing their meaning', () => {
  it.each([
    ['WAITING_FOR_SELLER_RESPONSE', 'Waiting for seller response'],
    ['MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'Merchandise or service not received'],
    ['CHARGEBACK', 'Chargeback'],
    ['RESOLVED', 'Resolved'],
  ])('%s', (code, want) => expect(humanise(code)).toBe(want));
  it('leaves anything that is not a plain code as it is, escaped by the page', () => {
    expect(humanise('<b>')).toBe('<b>');
  });
});

describe('deadlineText', () => {
  const now = new Date('2026-10-20T12:00:00.000Z');
  it('is the UTC time, and says when it has passed', () => {
    expect(deadlineText('2026-10-22T18:29:59.000Z', now)).toBe('2026-10-22 18:29 UTC');
    expect(deadlineText('2026-10-20T11:59:00.000Z', now)).toBe('2026-10-20 11:59 UTC · overdue');
  });
  it('says None when PayPal sent no deadline, and nothing else for a bad one', () => {
    expect(deadlineText(null, now)).toBe('None');
    expect(deadlineText('not a date', now)).toBe('None');
  });
});

describe('sortInbox: deadline first, open before resolved', () => {
  const row = (disputeId: string, status: string, deadline: string | null): InboxRow =>
    ({ id: disputeId, disputeId, status, deadline }) as InboxRow;
  it('orders by earliest deadline, then open without one, then resolved', () => {
    const rows = [
      row('PP-E', 'RESOLVED', null),
      row('PP-D', 'UNDER_REVIEW', null),
      row('PP-B', 'WAITING_FOR_SELLER_RESPONSE', '2026-10-25T00:00:00.000Z'),
      row('PP-A', 'WAITING_FOR_SELLER_RESPONSE', '2026-10-22T00:00:00.000Z'),
      row('PP-C', 'RESOLVED', '2026-10-21T00:00:00.000Z'),
    ];
    expect(sortInbox(rows).map((r) => r.disputeId)).toEqual(['PP-A', 'PP-B', 'PP-D', 'PP-C', 'PP-E']);
  });
  it('breaks ties by dispute id and does not change its input', () => {
    const rows = [row('PP-2', 'OPEN', null), row('PP-1', 'OPEN', null)];
    expect(sortInbox(rows).map((r) => r.disputeId)).toEqual(['PP-1', 'PP-2']);
    expect(rows.map((r) => r.disputeId)).toEqual(['PP-2', 'PP-1']);
  });
});
