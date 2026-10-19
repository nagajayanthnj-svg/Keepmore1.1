import { describe, expect, it } from 'vitest';
import { carrierLocalDate } from '../../src/normalise/time';
import { fixedClock, systemClock } from '../../src/lib/clock';

describe('carrierLocalDate', () => {
  it('moves the date forward in Asia/Kolkata (UTC+5:30)', () => {
    expect(carrierLocalDate('2026-10-21T20:30:00Z', 'Asia/Kolkata')).toBe('2026-10-22');
  });

  it('keeps the date just before the boundary', () => {
    expect(carrierLocalDate('2026-10-21T18:29:59Z', 'Asia/Kolkata')).toBe('2026-10-21');
    expect(carrierLocalDate('2026-10-21T18:30:00Z', 'Asia/Kolkata')).toBe('2026-10-22');
  });

  it('moves the date back for zones behind UTC', () => {
    expect(carrierLocalDate('2026-10-22T03:00:00Z', 'America/Los_Angeles')).toBe('2026-10-21');
  });

  it('accepts a Date and an offset timestamp', () => {
    expect(carrierLocalDate(new Date('2026-10-21T20:30:00Z'), 'Asia/Kolkata')).toBe('2026-10-22');
    expect(carrierLocalDate('2026-10-22T02:00:00+05:30', 'UTC')).toBe('2026-10-21');
  });

  it('follows daylight saving', () => {
    expect(carrierLocalDate('2026-07-01T23:30:00Z', 'Europe/London')).toBe('2026-07-02');
    expect(carrierLocalDate('2026-12-01T23:30:00Z', 'Europe/London')).toBe('2026-12-01');
  });

  it('rejects timestamps without a UTC offset, invalid dates and unknown zones', () => {
    expect(() => carrierLocalDate('2026-10-21T20:30:00', 'Asia/Kolkata')).toThrow();
    expect(() => carrierLocalDate('2026-10-21', 'Asia/Kolkata')).toThrow();
    expect(() => carrierLocalDate('not a date', 'Asia/Kolkata')).toThrow();
    expect(() => carrierLocalDate('2026-10-21T20:30:00Z', 'Mars/Olympus')).toThrow();
  });
});

describe('clock', () => {
  it('fixedClock always returns the same instant', () => {
    const now = fixedClock('2026-10-21T20:30:00Z');
    expect(now().toISOString()).toBe('2026-10-21T20:30:00.000Z');
    expect(now().getTime()).toBe(now().getTime());
  });

  it('systemClock returns the current time', () => {
    expect(Math.abs(systemClock().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('fixedClock returns a fresh Date each call, so callers cannot mutate it', () => {
    const now = fixedClock('2026-10-21T20:30:00Z');
    now().setUTCFullYear(2000);
    expect(now().getUTCFullYear()).toBe(2026);
  });
});
