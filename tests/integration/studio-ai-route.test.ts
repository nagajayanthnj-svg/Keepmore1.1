import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleStudioAi } from '../../src/ai/studio-ai-route';
import { seedDemo } from '../../src/demo/seed';
import type { Db } from '../../src/lib/db';
import { createTestDb } from '../helpers/test-db';

let db: Db;
let close: () => Promise<void>;
beforeEach(async () => {
  ({ db, close } = await createTestDb());
  await seedDemo(db);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await close();
});

const req = (text: string) => ({
  input: [{ id: 'u', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text }] }],
  responseFormat: { type: 'text' },
});
const gemini = { kind: 'gemini' as const, apiKey: 'KEY123', model: 'gemini-3.5-flash-lite' };
const okFetch = () =>
  vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Here is your chart.' }] }, finishReason: 'STOP' }] }), { status: 200 }));

describe('POST /api/studio-ai (T-405 AI assistant)', () => {
  it('503 when no AI provider is set', async () => {
    expect((await handleStudioAi({ db, ai: null }, req('hi'))).status).toBe(503);
  });

  it('answers through Gemini with the key in a header only, and logs the call', async () => {
    const f = okFetch();
    vi.stubGlobal('fetch', f);
    const res = await handleStudioAi({ db, ai: gemini }, req('Show fees by country'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.output[0].content[0].text).toBe('Here is your chart.');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain('KEY123');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY123');
    expect(JSON.stringify(body)).not.toContain('KEY123');
    const run = await db.agentRun.findFirstOrThrow({ where: { caseId: 'studio-ai' } });
    expect(run).toMatchObject({ mode: 'AI', provider: 'gemini', validation: 'PASS' });
  });

  it('403 when the request carries a real (non-demo) order id: only synthetic demo data may reach the model', async () => {
    vi.stubGlobal('fetch', okFetch());
    await db.order.create({
      data: { paypalOrderId: '5O190127TN364715T', captureId: '3C679366HH908993F', itemsJson: '[]', country: 'US', grossMinor: 100, currency: 'USD', buyerHash: 'b'.repeat(64) },
    });
    const res = await handleStudioAi({ db, ai: gemini }, req('What about order 5O190127TN364715T?'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'REAL_DATA' });
    expect(await db.agentRun.count({ where: { caseId: 'studio-ai' } })).toBe(0);
  });

  it('429 at the daily cap', async () => {
    vi.stubGlobal('fetch', okFetch());
    await handleStudioAi({ db, ai: gemini, dailyCap: 1 }, req('a'));
    expect((await handleStudioAi({ db, ai: gemini, dailyCap: 1 }, req('b'))).status).toBe(429);
  });

  it('a Gemini error is a failed response with the status, never the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"bad key KEY123"}}', { status: 400 })));
    const res = await handleStudioAi({ db, ai: gemini }, req('x'));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('KEY123');
  });

  describe('error capture: AgentRun.validation says why Gemini refused', () => {
    const lastValidation = async () => (await db.agentRun.findFirstOrThrow({ where: { caseId: 'studio-ai' }, orderBy: { createdAt: 'desc' } })).validation;
    const failWith = (status: number, body: string, headers: Record<string, string> = {}) =>
      vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers })));

    it('stores the HTTP status and the error message from a JSON error body', async () => {
      failWith(400, JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Unknown name "foo" at tools[0]' } }));
      await handleStudioAi({ db, ai: gemini }, req('x'));
      const v = await lastValidation();
      expect(v).toContain('FAILED: HTTP 400');
      expect(v).toContain('INVALID_ARGUMENT');
      expect(v).toContain('Unknown name "foo" at tools[0]');
    });

    it('stores Retry-After (seconds) with a 429', async () => {
      failWith(429, JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for requests per minute' } }), { 'retry-after': '37' });
      await handleStudioAi({ db, ai: gemini }, req('x'));
      const v = await lastValidation();
      expect(v).toContain('FAILED: HTTP 429');
      expect(v).toContain('retry-after 37s');
      expect(v).toContain('RESOURCE_EXHAUSTED');
    });

    it('never stores the API key, a request header value or a thought signature', async () => {
      const sig = 'EmAKXgFpFH0TIG7vPwTFFRHI7ipDtDDggDpyzDmxx6cyAMxnJgjkud0zc4aoTDvaO4nJuWPVwltyJXOoPewuckM544ai6E4kwS/J1VTFI0oOz38fmscNRJQo1BMokrWT+1w=';
      failWith(
        400,
        JSON.stringify({
          error: { status: 'INVALID_ARGUMENT', message: `key KEY123 and x-goog-api-key: KEY123 and sig:${sig} and thoughtSignature ${sig} and AIzaSyA1234567890abcdefghijklmnopqrstuv` },
        }),
      );
      await handleStudioAi({ db, ai: gemini }, req('x'));
      const run = await db.agentRun.findFirstOrThrow({ where: { caseId: 'studio-ai' } });
      for (const bad of ['KEY123', sig, 'EmAKXgFp', 'AIzaSy', 'x-goog-api-key']) {
        expect(run.validation).not.toContain(bad);
        expect(run.outputJson).not.toContain(bad);
      }
      expect(run.validation).toContain('INVALID_ARGUMENT');
    });

    it('caps the stored error message at 300 characters', async () => {
      failWith(400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: 'word '.repeat(500) } }));
      await handleStudioAi({ db, ai: gemini }, req('x'));
      const v = await lastValidation();
      expect(v.length).toBeLessThanOrEqual('FAILED: HTTP 400 | '.length + 300);
      expect(v).toContain('word word');
    });

    it('stores only the status when the body is not JSON (no raw HTML or text)', async () => {
      failWith(503, '<html>upstream secret page</html>');
      await handleStudioAi({ db, ai: gemini }, req('x'));
      expect(await lastValidation()).toBe('FAILED: HTTP 503');
    });

    it('does not change what the browser receives', async () => {
      failWith(429, JSON.stringify({ error: { message: 'Quota exceeded' } }), { 'retry-after': '5' });
      const res = await handleStudioAi({ db, ai: gemini }, req('x'));
      expect(res.status).toBe(502);
      expect(await res.json()).toMatchObject({ status: 'failed', output: [], error: { code: 'HTTP_429', message: 'The model could not answer.' } });
    });
  });

  it('400 for a body that is not a Studio request', async () => {
    expect((await handleStudioAi({ db, ai: gemini }, { nope: 1 })).status).toBe(400);
  });

  it('the test fixture answers without a network call', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const res = await handleStudioAi({ db, ai: { kind: 'fixture' } }, req('x'));
    expect(res.status).toBe(200);
    expect(f).not.toHaveBeenCalled();
    expect((await res.json()).output[0].content[0].text).toMatch(/fixture/i);
  });
});
