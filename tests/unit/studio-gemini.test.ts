import { describe, expect, it } from 'vitest';
import { fromGemini, realDataIn, toGemini, DUMMY_SIGNATURE } from '../../src/ai/studio-gemini';

const user = (text: string) => ({ id: 'u1', kind: 'input', type: 'message', role: 'user', status: 'completed', content: [{ type: 'text', text }] });

describe('Studio AI request to Gemini', () => {
  it('instructions and system messages become the system instruction; user and assistant text become turns', () => {
    const g = toGemini({
      instructions: 'You build dashboards.',
      input: [
        { id: 's', kind: 'input', type: 'message', role: 'system', status: 'completed', content: [{ type: 'text', text: 'Extra rule.' }] },
        user('Show fees by country'),
        { id: 'a', kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: 'Done.', annotations: [] }] },
      ],
      responseFormat: { type: 'text' },
    } as never);
    expect(g.systemInstruction).toEqual({ parts: [{ text: 'You build dashboards.\n\nExtra rule.' }] });
    expect(g.contents).toEqual([
      { role: 'user', parts: [{ text: 'Show fees by country' }] },
      { role: 'model', parts: [{ text: 'Done.' }] },
    ]);
  });

  it('a tool call goes back with its thought signature, and its result is matched to the call by id', () => {
    const g = toGemini({
      input: [
        user('go'),
        { id: `sig:abc123`, kind: 'output', type: 'function_call', callId: 'c1', name: 'add_widget', arguments: '{"type":"grid"}' },
        { kind: 'input', type: 'function_call_output', callId: 'c1', output: '{"ok":true}', status: 'completed' },
      ],
      responseFormat: { type: 'text' },
    } as never);
    expect(g.contents[1]).toEqual({ role: 'model', parts: [{ functionCall: { name: 'add_widget', args: { type: 'grid' } }, thoughtSignature: 'abc123' }] });
    expect(g.contents[2]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'add_widget', response: { output: '{"ok":true}' } } }] });
  });

  it('a tool call with no signature of ours gets the documented placeholder', () => {
    const g = toGemini({
      input: [{ id: 'x', kind: 'output', type: 'function_call', callId: 'c', name: 'f', arguments: '{}' }],
      responseFormat: { type: 'text' },
    } as never);
    expect((g.contents[0]!.parts[0] as { thoughtSignature?: string }).thoughtSignature).toBe(DUMMY_SIGNATURE);
  });

  it('tools are passed as JSON Schema; tool choice and a JSON answer format map across', () => {
    const g = toGemini({
      input: [user('x')],
      tools: [{ name: 'f', description: 'does f', parameters: { type: 'object', properties: { a: { type: 'string' } } } }],
      toolChoice: { name: 'f' },
      responseFormat: { type: 'json', name: 'plan', schema: { type: 'object' } },
    } as never);
    expect(g.tools).toEqual([{ functionDeclarations: [{ name: 'f', description: 'does f', parametersJsonSchema: { type: 'object', properties: { a: { type: 'string' } } } }] }]);
    expect(g.toolConfig).toEqual({ functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['f'] } });
    expect(g.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } });
  });
});

describe('Gemini answer to Studio output items', () => {
  it('text becomes one assistant message; function calls become tool calls carrying the signature', () => {
    const r = fromGemini(
      {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Adding a chart. ' },
                { text: 'Here it is.' },
                { functionCall: { name: 'add_widget', args: { type: 'grid' } }, thoughtSignature: 'SIG' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      },
      'gemini-x',
    );
    expect(r.status).toBe('completed');
    expect(r.output[0]).toMatchObject({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Adding a chart. Here it is.' }] });
    expect(r.output[1]).toMatchObject({ type: 'function_call', name: 'add_widget', arguments: '{"type":"grid"}', id: 'sig:SIG' });
    expect((r.output[1] as { callId: string }).callId).toMatch(/^call_/);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });
  it('no candidate is a failed response with a reason, never an empty success', () => {
    const r = fromGemini({ promptFeedback: { blockReason: 'SAFETY' } }, 'm');
    expect(r.status).toBe('failed');
    expect(r.error?.code).toBe('SAFETY');
  });
});

describe('real data guard (only synthetic demo data may reach the model)', () => {
  it('finds a real order, capture or dispute id anywhere in the request', () => {
    const body = JSON.stringify({ input: [{ content: [{ text: 'order 5O190127TN364715T and PP-R-MHL-10193741' }] }] });
    expect(realDataIn(body, ['5O190127TN364715T', 'PP-R-MHL-10193741', 'NOTHERE'])).toEqual(['5O190127TN364715T', 'PP-R-MHL-10193741']);
  });
  it('demo ids pass', () => expect(realDataIn('DEMO-ORD-0001 PP-DEMO-0003', ['5O190127TN364715T'])).toEqual([]));
});
