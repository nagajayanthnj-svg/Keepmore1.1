// The browser half of AG Studio's AI assistant (T-405). It never talks to the model: it posts Studio's request to
// our /api/studio-ai route (which holds the key and refuses real data) and replays the answer as Studio events.
import type { AgLlmAdapter, AgLlmRequest, AgLlmResponse } from 'ag-studio';

type Ev = { type: string } & Record<string, unknown>;
type Item = { type: string; id?: string; callId?: string; name?: string; arguments?: string; content?: { type: string; text?: string }[] };

const REASON: Record<string, string> = {
  REAL_DATA: 'The assistant only works on demo data, and this request contained real order data.',
  DAILY_CAP: 'The daily limit for the assistant is reached.',
  AI_OFF: 'The assistant is not set up on this server.',
};

export function eventsFor(r: AgLlmResponse): Ev[] {
  if (r.status === 'failed') return [{ type: 'RUN_ERROR', message: r.error?.message ?? 'The assistant could not answer.', code: r.error?.code }];
  const out: Ev[] = [];
  for (const i of r.output as unknown as Item[]) {
    if (i.type === 'message') {
      const id = i.id ?? 'msg';
      const text = (i.content ?? []).map((c) => c.text ?? '').join('');
      out.push({ type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' }, { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: text }, { type: 'TEXT_MESSAGE_END', messageId: id });
    } else if (i.type === 'function_call' && i.callId) {
      out.push(
        { type: 'TOOL_CALL_START', toolCallId: i.callId, toolCallName: i.name },
        { type: 'TOOL_CALL_ARGS', toolCallId: i.callId, delta: i.arguments ?? '{}' },
        { type: 'TOOL_CALL_END', toolCallId: i.callId },
      );
    }
  }
  return out;
}

const failed = (code: string, message: string): AgLlmResponse =>
  ({ id: 'resp_error', createdAt: Math.floor(Date.now() / 1000), status: 'failed', output: [], error: { code, message } }) as AgLlmResponse;

export function keepMoreAdapter(): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options) {
      const complete: Promise<AgLlmResponse> = (async () => {
        try {
          const res = await fetch('/api/studio-ai', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(request),
            signal: options?.signal,
          });
          const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          if (typeof body.error === 'string' && !('output' in body)) return failed(body.error, REASON[body.error] ?? `The assistant could not answer (${body.error}).`);
          return body as unknown as AgLlmResponse;
        } catch {
          return failed('NETWORK', 'The assistant could not be reached.');
        }
      })();
      return {
        complete,
        stream: {
          async *[Symbol.asyncIterator]() {
            for (const e of eventsFor(await complete)) yield e as never;
          },
        },
      };
    },
  };
}
