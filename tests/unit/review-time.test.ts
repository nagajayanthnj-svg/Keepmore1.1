import { describe, expect, it } from 'vitest';
import { carrierLocalDate } from '../../src/normalise/time';

// Independent review of T-105: DST transitions, non-hour offsets and day boundaries.
// 2026 transitions: New York 8 Mar 07:00Z (EST->EDT) and 1 Nov 06:00Z (EDT->EST);
// London 29 Mar 01:00Z (GMT->BST) and 25 Oct 01:00Z (BST->GMT).

const ms = (iso: string, delta: number) => new Date(Date.parse(iso) + delta).toISOString();

describe('review: the 12 DST transition instants of 2026 (1 ms before, at, 1 ms after)', () => {
  const transitions = [
    ['America/New_York', '2026-03-08T07:00:00.000Z', '2026-03-08'],
    ['America/New_York', '2026-11-01T06:00:00.000Z', '2026-11-01'],
    ['Europe/London', '2026-03-29T01:00:00.000Z', '2026-03-29'],
    ['Europe/London', '2026-10-25T01:00:00.000Z', '2026-10-25'],
  ] as const;
  const cases = transitions.flatMap(([tz, at, date]) => [-1, 0, 1].map((d) => [tz, ms(at, d), date] as const));

  it('covers 12 instants', () => {
    expect(cases).toHaveLength(12);
  });

  it.each(cases)('%s %s -> %s', (tz, utc, date) => {
    expect(carrierLocalDate(utc, tz)).toBe(date);
    expect(carrierLocalDate(new Date(utc), tz)).toBe(date);
  });
});

describe('review: local midnight either side of a DST change uses the right offset', () => {
  it.each([
    // New York, spring: midnight on 8 Mar is still EST (-5), midnight on 9 Mar is EDT (-4)
    ['America/New_York', '2026-03-08T04:59:59.999Z', '2026-03-07'],
    ['America/New_York', '2026-03-08T05:00:00.000Z', '2026-03-08'],
    ['America/New_York', '2026-03-09T03:59:59.999Z', '2026-03-08'],
    ['America/New_York', '2026-03-09T04:00:00.000Z', '2026-03-09'],
    // New York, autumn: midnight on 1 Nov is EDT (-4), midnight on 2 Nov is EST (-5)
    ['America/New_York', '2026-11-01T03:59:59.999Z', '2026-10-31'],
    ['America/New_York', '2026-11-01T04:00:00.000Z', '2026-11-01'],
    ['America/New_York', '2026-11-02T04:59:59.999Z', '2026-11-01'],
    ['America/New_York', '2026-11-02T05:00:00.000Z', '2026-11-02'],
    // London, spring: midnight on 30 Mar is BST (+1)
    ['Europe/London', '2026-03-29T22:59:59.999Z', '2026-03-29'],
    ['Europe/London', '2026-03-29T23:00:00.000Z', '2026-03-30'],
    // London, autumn: midnight on 25 Oct is BST (+1), midnight on 26 Oct is GMT (+0)
    ['Europe/London', '2026-10-24T22:59:59.999Z', '2026-10-24'],
    ['Europe/London', '2026-10-24T23:00:00.000Z', '2026-10-25'],
    ['Europe/London', '2026-10-25T23:59:59.999Z', '2026-10-25'],
    ['Europe/London', '2026-10-26T00:00:00.000Z', '2026-10-26'],
  ] as const)('%s %s -> %s', (tz, utc, date) => {
    expect(carrierLocalDate(utc, tz)).toBe(date);
  });
});

describe('review: half-hour and 45-minute zones at midnight and 23:59:59.999', () => {
  it.each([
    // Asia/Kolkata is +05:30: local midnight on 21 Oct is 20 Oct 18:30Z
    ['Asia/Kolkata', '2026-10-20T18:29:59.999Z', '2026-10-20'],
    ['Asia/Kolkata', '2026-10-20T18:30:00.000Z', '2026-10-21'],
    ['Asia/Kolkata', '2026-10-20T23:59:59.999+05:30', '2026-10-20'],
    ['Asia/Kolkata', '2026-10-21T00:00:00.000+05:30', '2026-10-21'],
    ['Asia/Kolkata', '2026-10-20T18:29:59.999+00:00', '2026-10-20'],
    // Asia/Kathmandu is +05:45: local midnight on 21 Oct is 20 Oct 18:15Z
    ['Asia/Kathmandu', '2026-10-20T18:14:59.999Z', '2026-10-20'],
    ['Asia/Kathmandu', '2026-10-20T18:15:00.000Z', '2026-10-21'],
    ['Asia/Kathmandu', '2026-10-20T23:59:59.999+05:45', '2026-10-20'],
    ['Asia/Kathmandu', '2026-10-21T00:00:00.000+0545', '2026-10-21'],
    // The same instant on the other side of the world
    ['America/New_York', '2026-10-20T23:59:59.999+05:45', '2026-10-20'],
  ] as const)('%s %s -> %s', (tz, utc, date) => {
    expect(carrierLocalDate(utc, tz)).toBe(date);
  });
});

describe('review: UTC day boundaries', () => {
  it.each([
    ['2026-10-20T00:00:00.000Z', '2026-10-20'],
    ['2026-10-20T23:59:59.999Z', '2026-10-20'],
    ['2026-10-21T00:00:00.000Z', '2026-10-21'],
    ['2026-12-31T23:59:59.999Z', '2026-12-31'],
    ['2027-01-01T00:00:00.000Z', '2027-01-01'],
  ])('%s -> %s', (utc, date) => {
    expect(carrierLocalDate(utc, 'UTC')).toBe(date);
  });

  it('does not round 23:59:59.999 up to the next second or day', () => {
    expect(carrierLocalDate('2026-10-20T18:29:59.999Z', 'Asia/Kolkata')).toBe('2026-10-20');
    expect(carrierLocalDate('2026-11-02T04:59:59.999Z', 'America/New_York')).toBe('2026-11-01');
  });
});
