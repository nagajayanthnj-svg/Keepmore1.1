// Characterization only (no production change). All data is SYNTHETIC. Builds the verify body exactly as
// src/paypal/webhook-verify.ts:42-44 does, then checks it parses, and checks what the client sends when
// the RawJson it receives is not the client's own class (two bundle copies).
import { describe, expect, it } from 'vitest';
import { createPayPalClient } from '../../src/paypal/client';

const BRAND = Symbol.for('keepmore.rawjson');

const build = (fields: Record<string, unknown>, webhookId: unknown, rawBody: string) => {
  const head = JSON.stringify({ ...fields, webhook_id: webhookId }); // webhook-verify.ts:42
  return `${head.slice(0, -1)},"webhook_event":${rawBody}}`; // :44
};
const F = { auth_algo: 'A', cert_url: 'C', transmission_id: 'I', transmission_sig: 'S', transmission_time: 'T' };
const ok = (s: string) => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
};

describe('verify body string (SYNTHETIC)', () => {
  it('normal body parses', () => expect(ok(build(F, 'WH1', '{"id":"E1"}'))).toBe(true));
  it('trailing newline and CRLF parse (JSON whitespace)', () => {
    expect(ok(build(F, 'WH1', '{"id":"E1"}\n'))).toBe(true);
    expect(ok(build(F, 'WH1', '{\r\n"id":"E1"\r\n}\r\n'))).toBe(true);
  });
  it('non-ASCII parses', () => expect(ok(build(F, 'WH1', '{"n":"café ₹"}'))).toBe(true));
  it('BOM before the body does NOT parse', () => expect(ok(build(F, 'WH1', '﻿{"id":"E1"}'))).toBe(false));
  it('empty body does NOT parse', () => expect(ok(build(F, 'WH1', ''))).toBe(false));
  it('non-JSON body does NOT parse', () => expect(ok(build(F, 'WH1', 'not json'))).toBe(false));
  it('undefined webhook_id is dropped: still parses, field missing', () => {
    const s = build(F, undefined, '{"id":"E1"}');
    expect(ok(s)).toBe(true);
    expect('webhook_id' in JSON.parse(s)).toBe(false);
  });
});

describe('what the client sends for a RawJson from another bundle copy (SYNTHETIC)', () => {
  const sent = async (make: (text: string) => unknown) => {
    let body = '';
    const fetchFake = (async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/v1/oauth2/token')) return Response.json({ access_token: 't', expires_in: 3600 });
      body = String(init?.body);
      return Response.json({ verification_status: 'SUCCESS' });
    }) as typeof fetch;
    const c = createPayPalClient({ clientId: 'x', clientSecret: 'y', baseUrl: 'http://p.test', fetch: fetchFake });
    await c.post('/v1/notifications/verify-webhook-signature', make(build(F, 'WH1', '{"id":"E1"}')));
    return body;
  };

  it('the same class is sent as the raw text', async () => {
    const { RawJson } = await import('../../src/paypal/client');
    const body = await sent((t) => new RawJson(t));
    expect(Object.keys(JSON.parse(body))).toContain('webhook_event');
  });

  it('a branded lookalike (second module copy) is sent as the raw verify body', async () => {
    class RawJson {
      readonly [BRAND] = true;
      constructor(readonly text: string) {}
    }
    const body = await sent((t) => new RawJson(t));
    expect(Object.keys(JSON.parse(body))).toContain('webhook_event');
    expect(Object.keys(JSON.parse(body))).not.toEqual(['text']);
  });

  it('an unbranded lookalike is still serialised as {"text": ...} (the old failure shape)', async () => {
    class Unbranded {
      constructor(readonly text: string) {}
    }
    expect(Object.keys(JSON.parse(await sent((t) => new Unbranded(t))))).toEqual(['text']);
  });
});
