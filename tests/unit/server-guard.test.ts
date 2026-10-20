import { describe, expect, it, vi } from 'vitest';
import { guard } from '../../src/lib/server-deps';

describe('guard', () => {
  it('passes a good response through and logs nothing', async () => {
    const log = vi.fn();
    const res = await guard('capture', async () => Response.json({ ok: 1 }), log);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 1 });
    expect(log).not.toHaveBeenCalled();
  });
  it('logs the status and body of an error response, and still returns it intact', async () => {
    const log = vi.fn();
    const res = await guard(
      'capture',
      async () => Response.json({ error: 'PAYPAL_ERROR', debugId: 'abc' }, { status: 502 }),
      log,
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'PAYPAL_ERROR', debugId: 'abc' });
    expect(log).toHaveBeenCalledWith('capture failed: 502 {"error":"PAYPAL_ERROR","debugId":"abc"}');
  });
  it('turns a thrown error into a JSON 500 and logs the message', async () => {
    const log = vi.fn();
    const res = await guard(
      'capture',
      async () => {
        throw new Error('no such column: Order.sellerProtection');
      },
      log,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'INTERNAL' });
    expect(log).toHaveBeenCalledWith('capture crashed: no such column: Order.sellerProtection');
  });
  it('never puts secrets in the log line it builds', async () => {
    const log = vi.fn();
    process.env.PAYPAL_CLIENT_SECRET = 'super-secret-value';
    await guard(
      'x',
      async () => {
        throw new Error('boom');
      },
      log,
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('super-secret-value');
  });
});
