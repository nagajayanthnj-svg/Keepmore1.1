import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/lib/db';
import { PayPalError, createPayPalClient } from '../../src/paypal/client';
import { verifyWebhookSignature } from '../../src/paypal/webhook-verify';
import { handleWebhook, type WebhookDeps } from '../../src/webhooks/receiver';
import { createTestDb } from '../helpers/test-db';

const fx = (n: string) => JSON.parse(readFileSync(`tests/fixtures/paypal/${n}.json`, 'utf8'));
const resolved = fx('webhook-customer-dispute-resolved-86105147-cbed-11f1-9883-c743da698d78'); // WH-41W01260M46157813-17948266PJ8416714, PP-R-RAV-10193566
const updated = fx('webhook-customer-dispute-updated-0ef6d19c-cbed-11f1-80f8-d105671fe013');
const capture = fx('webhook-payment-capture-completed-ffdd69a2-cbd1-11f1-ab13-f11193100739');
const NOW = new Date('2026-10-21T10:00:00Z');

let db: Db;
let close: () => Promise<void>;
let synced: string[] = [];
let deferred: Promise<unknown>[] = [];
let verdict: () => Promise<boolean>;
let deps: WebhookDeps;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  synced = [];
  deferred = [];
  verdict = async () => true;
  deps = {
    db,
    verify: () => verdict(),
    syncDispute: async (id) => {
      synced.push(id);
    },
    defer: (p) => {
      deferred.push(p);
    },
    clock: () => NOW,
  };
});
afterEach(async () => {
  await close();
});

const request = (f: { headers: Record<string, string>; body: unknown }, rawOverride?: string) =>
  new Request('http://x/api/webhooks/paypal', {
    method: 'POST',
    headers: f.headers,
    body: rawOverride ?? JSON.stringify(f.body),
  });
const send = async (f: { headers: Record<string, string>; body: unknown }) => {
  const res = await handleWebhook(request(f), deps);
  await Promise.all(deferred);
  return res;
};
const rows = () => db.webhookEvent.findMany();

describe('a verified dispute event', () => {
  it('answers 200, stores the event as verified and syncs that dispute once', async () => {
    const res = await send(resolved);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ACCEPTED' });
    expect(synced).toEqual(['PP-R-RAV-10193566']);
    const [row] = await rows();
    expect(row).toMatchObject({
      eventId: 'WH-41W01260M46157813-17948266PJ8416714',
      type: 'CUSTOMER.DISPUTE.RESOLVED',
      verified: true,
      result: 'SYNC_REQUESTED',
    });
    expect(row!.processedAt).toEqual(NOW);
  });

  it('answers before the sync has finished', async () => {
    let release!: () => void;
    deps.syncDispute = () => new Promise<void>((r) => (release = r));
    const res = await handleWebhook(request(resolved), deps);
    expect(res.status).toBe(200);
    expect((await rows())[0]!.processedAt).toBeNull(); // still running
    release();
    await Promise.all(deferred);
    expect((await rows())[0]!.processedAt).toEqual(NOW);
  });

  it('stores nothing from the body but the event id and type', async () => {
    await send(resolved);
    const dump = JSON.stringify(await rows());
    expect(dump).not.toContain('PP-R-RAV-10193566');
    expect(dump).not.toContain(resolved.headers['paypal-transmission-sig']);
  });
});

describe('deduplication on event id', () => {
  it('syncs once when the same event arrives twice, and still answers 200', async () => {
    await send(resolved);
    const again = await send(resolved);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: 'DUPLICATE' });
    expect(synced).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it('syncs once when five copies arrive at the same moment', async () => {
    const all = await Promise.all(Array.from({ length: 5 }, () => handleWebhook(request(resolved), deps)));
    await Promise.all(deferred);
    expect(all.every((r) => r.status === 200)).toBe(true);
    expect(synced).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it('treats different event ids for the same dispute as different events', async () => {
    await send(resolved);
    await send(updated);
    expect(synced).toEqual(['PP-R-RAV-10193566', 'PP-R-RAV-10193566']);
  });
});

describe('an event that does not verify', () => {
  beforeEach(() => {
    verdict = async () => false;
  });

  it('answers 401, stores it as unverified and triggers nothing', async () => {
    const res = await send(resolved);
    expect(res.status).toBe(401);
    expect(synced).toHaveLength(0);
    const [row] = await rows();
    expect(row).toMatchObject({ eventId: resolved.body.id, verified: false, processedAt: null, result: 'UNVERIFIED' });
  });

  it('does not use up the event id: the real delivery that follows is still synced', async () => {
    await send(resolved); // a forgery that reuses a real event id
    verdict = async () => true;
    const real = await send(resolved);
    expect(real.status).toBe(200);
    expect(await real.json()).toEqual({ status: 'ACCEPTED' });
    expect(synced).toHaveLength(1);
    const [row] = await rows();
    expect(row).toMatchObject({ verified: true, result: 'SYNC_REQUESTED' });
    expect(await rows()).toHaveLength(1);
  });

  it('a second forgery is stored once and never upgrades it', async () => {
    await send(resolved);
    await send(resolved);
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]!.verified).toBe(false);
  });
});

describe('events that are not dispute events, or carry a bad id', () => {
  it('stores a verified capture event and does not sync', async () => {
    const res = await send(capture);
    expect(res.status).toBe(200);
    expect(synced).toHaveLength(0);
    expect((await rows())[0]).toMatchObject({
      type: 'PAYMENT.CAPTURE.COMPLETED',
      verified: true,
      result: 'IGNORED_TYPE',
    });
  });

  it('never syncs a dispute id that does not look like one', async () => {
    const hostile = structuredClone(updated);
    hostile.body.id = 'WH-HOSTILE-1';
    hostile.body.resource.dispute_id = "PP-R-X'; DROP TABLE Order;--";
    const res = await send(hostile);
    expect(res.status).toBe(200);
    expect(synced).toHaveLength(0);
    expect((await rows())[0]!.result).toBe('IGNORED_BAD_ID');
  });

  it('keeps no sync wiring optional: without one the event is stored and marked', async () => {
    delete deps.syncDispute;
    await send(resolved);
    expect((await rows())[0]).toMatchObject({ verified: true, result: 'NO_SYNC_AVAILABLE' });
  });
});

describe('failures', () => {
  it('a failing sync is recorded, the answer is still 200, and the event stays deduplicated', async () => {
    deps.syncDispute = async () => {
      throw new Error('PayPal said no');
    };
    const res = await send(resolved);
    expect(res.status).toBe(200);
    const [row] = await rows();
    expect(row!.result).toMatch(/^ERROR: PayPal said no/);
    expect(row!.processedAt).toBeNull();
    await send(resolved);
    expect(await rows()).toHaveLength(1);
  });

  it('answers 503 and stores nothing when PayPal cannot be asked to verify, so PayPal sends it again', async () => {
    verdict = async () => {
      throw new Error('verify timed out');
    };
    const res = await send(resolved);
    expect(res.status).toBe(503);
    expect(await rows()).toHaveLength(0);
    expect(synced).toHaveLength(0);
  });

  it.each([
    ['not JSON', 'nope'],
    ['a JSON array', '[]'],
    ['no event id', JSON.stringify({ event_type: 'CUSTOMER.DISPUTE.UPDATED' })],
    ['no event type', JSON.stringify({ id: 'WH-1' })],
    ['an event id with symbols', JSON.stringify({ id: "WH-1'; --", event_type: 'X' })],
    ['an event id that is far too long', JSON.stringify({ id: `WH-${'A'.repeat(200)}`, event_type: 'X' })],
  ])('answers 400 for %s and stores nothing', async (_n, raw) => {
    const res = await handleWebhook(request(resolved, raw), deps);
    expect(res.status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it('hands the raw body, not a re-serialised one, to the verifier', async () => {
    const pretty = JSON.stringify(resolved.body, null, 4);
    let got = '';
    deps.verify = async (_h, rawBody) => {
      got = rawBody;
      return true;
    };
    await handleWebhook(request(resolved, pretty), deps);
    expect(got).toBe(pretty);
  });
});

describe('the log when PayPal rejects the verify request', () => {
  it('names the PayPal error, issue codes, field names, debug id and event type, and no header or body values', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    verdict = async () => {
      // Synthetic error (not a real PayPal response): the shape of a 400 with one field issue.
      throw new PayPalError({
        status: 400,
        message: 'Request is not well-formed, syntactically incorrect, or violates schema.',
        code: 'INVALID_REQUEST',
        debugId: 'SYNTHETIC-DEBUG-1',
        issues: ['INVALID_STRING_LENGTH'],
        fields: ['webhook_id'],
      });
    };
    const res = await send(resolved);
    expect(res.status).toBe(503); // behaviour unchanged
    const line = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    spy.mockRestore();
    expect(line).toContain(`webhook ${resolved.body.id}`);
    expect(line).toContain('status=400');
    expect(line).toContain('INVALID_REQUEST');
    expect(line).toContain('INVALID_STRING_LENGTH');
    expect(line).toContain('webhook_id');
    expect(line).toContain('SYNTHETIC-DEBUG-1');
    expect(line).toContain(resolved.body.event_type);
    for (const v of Object.values(resolved.headers) as string[]) expect(line).not.toContain(v);
    expect(line).not.toContain(resolved.body.resource.dispute_id);
  });
});

describe('the log on the real 400 path (client -> verifyWebhookSignature -> receiver)', () => {
  // SYNTHETIC bodies, not real PayPal responses: only the shape of a 400 INVALID_REQUEST.
  const syntheticClient = () => {
    const fetchFake = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/v1/oauth2/token')) {
        return Response.json({ access_token: 'SYNTHETIC-TOKEN', expires_in: 3600 });
      }
      return Response.json(
        {
          name: 'INVALID_REQUEST',
          message: 'Request is not well-formed, syntactically incorrect, or violates schema.',
          debug_id: 'SYNTHETIC-DEBUG-2',
          details: [{ field: '/webhook_event', issue: 'SYNTHETIC_ISSUE' }],
        },
        { status: 400 },
      );
    }) as typeof fetch;
    return createPayPalClient({ clientId: 'x', clientSecret: 'y', baseUrl: 'http://paypal.test', fetch: fetchFake });
  };
  const logFor = async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const paypal = syntheticClient();
    deps.verify = (h, raw) => verifyWebhookSignature(paypal, 'WEBHOOKID123456789', h, raw);
    const res = await send(resolved);
    const line = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    spy.mockRestore();
    return { res, line };
  };

  it('prints status, name, issues, fields and debug id for a 400 from PayPal', async () => {
    const { res, line } = await logFor();
    expect(res.status).toBe(503);
    expect(line).toContain(
      'status=400 name=INVALID_REQUEST issues=[SYNTHETIC_ISSUE] fields=[/webhook_event] debug=SYNTHETIC-DEBUG-2',
    );
  });

  it('still prints them when the error comes from another copy of the PayPalError class (bundler duplicate)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Same shape, different class identity: what `instanceof PayPalError` cannot match.
    class PayPalError extends Error {
      status = 400;
      code = 'INVALID_REQUEST';
      debugId = 'SYNTHETIC-DEBUG-3';
      issues = ['SYNTHETIC_ISSUE'];
      fields = ['/webhook_event'];
      override name = 'PayPalError';
    }
    verdict = async () => {
      throw new PayPalError('Request is not well-formed, syntactically incorrect, or violates schema.');
    };
    await send(resolved);
    const line = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    spy.mockRestore();
    expect(line).toContain(
      'status=400 name=INVALID_REQUEST issues=[SYNTHETIC_ISSUE] fields=[/webhook_event] debug=SYNTHETIC-DEBUG-3',
    );
  });
});
