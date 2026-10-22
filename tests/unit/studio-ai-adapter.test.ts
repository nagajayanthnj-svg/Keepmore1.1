import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventsFor, keepMoreAdapter } from '../../src/components/studio-ai-adapter';

const textResp = { id: 'r', createdAt: 1, status: 'completed', output: [{ id: 'm1', kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: 'Hi', annotations: [] }] }] };
const toolResp = { id: 'r', createdAt: 1, status: 'completed', output: [{ id: 'sig:S', kind: 'output', type: 'function_call', callId: 'c1', name: 'add_widget', arguments: '{"a":1}' }] };

describe('Studio AI adapter in the browser (T-405)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('turns a text answer into start, content and end events', () => {
    expect(eventsFor(textResp as never).map((e) => e.type)).toEqual(['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_END']);
  });
  it('turns a tool call into start, args and end events with the call id', () => {
    const ev = eventsFor(toolResp as never);
    expect(ev.map((e) => e.type)).toEqual(['TOOL_CALL_START', 'TOOL_CALL_ARGS', 'TOOL_CALL_END']);
    expect(ev[0]).toMatchObject({ toolCallId: 'c1', toolCallName: 'add_widget' });
    expect(ev[1]).toMatchObject({ delta: '{"a":1}' });
  });
  it('a failed answer is a run error', () => {
    expect(eventsFor({ id: 'r', createdAt: 1, status: 'failed', output: [], error: { code: 'X', message: 'no' } } as never)).toEqual([
      expect.objectContaining({ type: 'RUN_ERROR', code: 'X' }),
    ]);
  });
  it('posts to our own route, never to the model provider, and streams then completes', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(textResp), { status: 200 }));
    vi.stubGlobal('fetch', f);
    const h = keepMoreAdapter().executeTurn({ input: [], responseFormat: { type: 'text' } } as never);
    const seen: string[] = [];
    for await (const e of h.stream) seen.push(e.type);
    expect((await h.complete).status).toBe('completed');
    expect(seen).toContain('TEXT_MESSAGE_CONTENT');
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/studio-ai');
  });
  it('a refusal from our route (real data) completes as failed with the reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"REAL_DATA"}', { status: 403 })));
    const r = await keepMoreAdapter().executeTurn({ input: [], responseFormat: { type: 'text' } } as never).complete;
    expect(r).toMatchObject({ status: 'failed', error: { code: 'REAL_DATA' } });
  });
});
