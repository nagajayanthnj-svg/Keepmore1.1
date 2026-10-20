import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('instrumentation register', () => {
  it('starts nothing without PayPal credentials, or when disabled, or off the Node runtime', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', '');
    vi.stubEnv('PAYPAL_CLIENT_SECRET', '');
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    const set = vi.spyOn(globalThis, 'setInterval');
    const { register } = await import('../../src/instrumentation');
    await register();
    vi.stubEnv('PAYPAL_CLIENT_ID', 'id');
    vi.stubEnv('PAYPAL_CLIENT_SECRET', 's');
    vi.stubEnv('DISABLE_POLLER', '1');
    await register();
    vi.stubEnv('DISABLE_POLLER', '');
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await register();
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });

  it('starts one timer with credentials on the Node runtime', async () => {
    vi.stubEnv('PAYPAL_CLIENT_ID', 'id');
    vi.stubEnv('PAYPAL_CLIENT_SECRET', 's');
    vi.stubEnv('NEXT_RUNTIME', 'nodejs');
    vi.stubEnv('DISABLE_POLLER', '');
    vi.stubEnv('SYNC_INTERVAL_SECONDS', '60');
    vi.useFakeTimers();
    const set = vi.spyOn(globalThis, 'setInterval');
    const { register } = await import('../../src/instrumentation');
    await register();
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0]![1]).toBe(60_000);
    vi.clearAllTimers();
    vi.useRealTimers();
    set.mockRestore();
  });
});
