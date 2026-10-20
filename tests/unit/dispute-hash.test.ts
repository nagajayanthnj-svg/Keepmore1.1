import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { disputeRawHash } from '../../src/disputes/parse';

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const first = fx('dispute-details-first');

const reverseKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(reverseKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v)
            .reverse()
            .map(([k, x]) => [k, reverseKeys(x)]),
        )
      : v;

describe('disputeRawHash', () => {
  it('is 64 hex characters and the same for the same payload', () => {
    expect(disputeRawHash(first)).toMatch(/^[0-9a-f]{64}$/);
    expect(disputeRawHash(first)).toBe(disputeRawHash(structuredClone(first)));
  });

  it('does not depend on key order', () => {
    expect(disputeRawHash(reverseKeys(first))).toBe(disputeRawHash(first));
  });

  it('does not change when PayPal shuffles the links: the order differs between responses for the same state', () => {
    const shuffled = structuredClone(first);
    shuffled.links = [...shuffled.links].reverse();
    expect(shuffled.links.map((l: { rel: string }) => l.rel)).not.toEqual(
      first.links.map((l: { rel: string }) => l.rel),
    );
    expect(disputeRawHash(shuffled)).toBe(disputeRawHash(first));
  });

  it('changes when a link appears or goes: the allowed actions changed', () => {
    const fewer = structuredClone(first);
    fewer.links = fewer.links.filter((l: { rel: string }) => l.rel !== 'provide_evidence');
    expect(disputeRawHash(fewer)).not.toBe(disputeRawHash(first));
  });

  it.each([
    ['status', (d: Record<string, unknown>) => (d.status = 'UNDER_REVIEW')],
    ['update time', (d: Record<string, unknown>) => (d.update_time = '2026-10-19T18:00:00.000Z')],
    ['deadline', (d: Record<string, unknown>) => (d.seller_response_due_date = '2026-10-23T18:29:59.000Z')],
    ['amount', (d: Record<string, unknown>) => (d.dispute_amount = { currency_code: 'USD', value: '119.99' })],
    ['a message', (d: Record<string, unknown>) => (d.messages = [{ posted_by: 'BUYER', content: 'hi' }])],
    ['an evidence note', (d: Record<string, unknown>) => ((d.evidences as { notes?: string }[])[0]!.notes = 'changed')],
    ['a fund movement', (d: Record<string, unknown>) => (d.fund_movements = [])],
  ])('changes when the %s changes', (_name, mutate) => {
    const d = structuredClone(first);
    mutate(d);
    expect(disputeRawHash(d)).not.toBe(disputeRawHash(first));
  });

  it('keeps the order of lists that are not links: a different order of messages is a different payload', () => {
    const a = structuredClone(fx('dispute-details'));
    const b = structuredClone(a);
    b.messages = [...b.messages].reverse();
    expect(disputeRawHash(b)).not.toBe(disputeRawHash(a));
  });

  it('tells a resolved case from the same case before it resolved', () => {
    expect(disputeRawHash(fx('t009-PP-R-IUT-10193562-accept-3-final'))).not.toBe(
      disputeRawHash(fx('t009-PP-R-IUT-10193562-accept-1-before')),
    );
  });
});
