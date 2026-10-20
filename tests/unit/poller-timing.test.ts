import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STALE_AFTER_MS, isStale, pollIntervalSeconds, startPoller } from '../../src/disputes/poller';

describe('isStale: a case is stale after 5 minutes', () => {
  const synced = new Date('2026-10-20T10:00:00.000Z');
  const at = (ms: number) => new Date(synced.getTime() + ms);
  it('is fresh just under 5 minutes and stale from 5 minutes', () => {
    expect(STALE_AFTER_MS).toBe(300_000);
    expect(isStale(synced, at(299_999))).toBe(false);
    expect(isStale(synced, at(300_000))).toBe(true);
    expect(isStale(synced, at(3_600_000))).toBe(true);
  });
  it('treats a sync time in the future (clock skew) as fresh, not stale', () => {
    expect(isStale(at(10_000), synced)).toBe(false);
  });
});

describe('pollIntervalSeconds: SYNC_INTERVAL_SECONDS', () => {
  it.each([
    [undefined, 900],
    ['', 900],
    ['60', 60],
    ['900', 900],
    ['30', 30],
    ['29', 900],
    ['86401', 900],
    ['abc', 900],
    ['1.5', 900],
    ['-5', 900],
    ['60s', 900],
  ])('%j -> %j', (value, want) => {
    expect(pollIntervalSeconds(value)).toBe(want);
  });
});

describe('startPoller (fake timers)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs once per interval and stops when told to', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const stop = startPoller(run, 60_000);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(run).toHaveBeenCalledTimes(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('does not start a run while the last one is still going', async () => {
    let release!: () => void;
    const run = vi.fn().mockImplementation(() => new Promise<void>((r) => (release = r)));
    const stop = startPoller(run, 1000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    stop();
  });

  it('survives a run that throws and reports it', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined);
    const onError = vi.fn();
    const stop = startPoller(run, 1000, onError);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    stop();
  });
});
