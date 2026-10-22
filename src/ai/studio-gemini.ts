// AG Studio's AI assistant (T-405) talks the shape of AgLlmRequest / AgLlmResponse; Gemini talks generateContent.
// Pure translation both ways, used by the /api/studio-ai route. Tools are never run here: Studio runs them in the
// browser and sends the results back on the next turn.
// Gemini 3 wants each function call returned with its thought signature. We carry it in the tool call item's id
// ("sig:<signature>"), which Studio echoes back. UNVERIFIED live until the first run.
import { randomUUID } from 'node:crypto';

/** Google's documented placeholder for a function call that has no signature of its own. UNVERIFIED. */
export const DUMMY_SIGNATURE = 'skip_thought_signature_validator';

type Obj = Record<string, unknown>;
interface Item {
  id?: string;
  type: string;
  role?: string;
  content?: { type: string; text?: string }[];
  callId?: string;
  name?: string;
  arguments?: string;
  output?: string;
}
export interface StudioRequest {
  input: Item[];
  instructions?: string;
  tools?: { name: string; description: string; parameters: Obj }[];
  toolChoice?: 'auto' | 'none' | 'required' | { name: string };
  responseFormat: { type: 'text' } | { type: 'json'; name: string; schema: Obj };
}
type Part = { text: string } | { functionCall: { name: string; args: Obj }; thoughtSignature?: string } | { functionResponse: { name: string; response: Obj } };
export interface GeminiRequest {
  systemInstruction?: { parts: { text: string }[] };
  contents: { role: 'user' | 'model'; parts: Part[] }[];
  tools?: { functionDeclarations: { name: string; description: string; parametersJsonSchema: Obj }[] }[];
  toolConfig?: { functionCallingConfig: { mode: 'AUTO' | 'NONE' | 'ANY'; allowedFunctionNames?: string[] } };
  generationConfig: Obj;
}

const textOf = (i: Item) => (i.content ?? []).filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('');
const parseArgs = (s: string | undefined): Obj => {
  try {
    const v = JSON.parse(s ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
  } catch {
    return {};
  }
};

export function toGemini(req: StudioRequest): GeminiRequest {
  const system: string[] = req.instructions ? [req.instructions] : [];
  const contents: GeminiRequest['contents'] = [];
  const names = new Map<string, string>();
  const push = (role: 'user' | 'model', part: Part) => {
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };
  for (const i of req.input) {
    if (i.type === 'message' && i.role === 'system') system.push(textOf(i));
    else if (i.type === 'message' && i.role === 'user') push('user', { text: textOf(i) });
    else if (i.type === 'message' && i.role === 'assistant') {
      const t = textOf(i);
      if (t) push('model', { text: t });
    } else if (i.type === 'function_call' && i.name) {
      if (i.callId) names.set(i.callId, i.name);
      const sig = i.id?.startsWith('sig:') ? i.id.slice(4) : DUMMY_SIGNATURE;
      push('model', { functionCall: { name: i.name, args: parseArgs(i.arguments) }, thoughtSignature: sig });
    } else if (i.type === 'function_call_output' && i.callId) {
      push('user', { functionResponse: { name: names.get(i.callId) ?? 'tool', response: { output: i.output ?? '' } } });
    }
    // reasoning items are not sent back
  }
  const out: GeminiRequest = { contents, generationConfig: { temperature: 0.2 } };
  if (system.length) out.systemInstruction = { parts: [{ text: system.filter(Boolean).join('\n\n') }] };
  if (req.tools?.length) {
    out.tools = [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }];
    const c = req.toolChoice ?? 'auto';
    out.toolConfig = {
      functionCallingConfig:
        typeof c === 'object' ? { mode: 'ANY', allowedFunctionNames: [c.name] } : { mode: c === 'none' ? 'NONE' : c === 'required' ? 'ANY' : 'AUTO' },
    };
  }
  if (req.responseFormat.type === 'json') {
    out.generationConfig = { ...out.generationConfig, responseMimeType: 'application/json', responseJsonSchema: req.responseFormat.schema };
  }
  return out;
}

export interface StudioResponse {
  id: string;
  createdAt: number;
  status: 'completed' | 'failed' | 'incomplete';
  output: Obj[];
  error?: { code: string; message: string };
  incompleteDetails?: { reason?: 'max_output_tokens' | 'content_filter' };
  usage?: { inputTokens: number; outputTokens: number; totalTokens?: number };
  model?: string;
}

export function fromGemini(body: unknown, model: string): StudioResponse {
  const b = (body ?? {}) as Obj;
  const base = { id: `resp_${randomUUID()}`, createdAt: Math.floor(Date.now() / 1000), model };
  const cand = (Array.isArray(b.candidates) ? b.candidates[0] : undefined) as Obj | undefined;
  const parts = ((cand?.content as Obj | undefined)?.parts ?? []) as Obj[];
  if (!cand || parts.length === 0) {
    const reason = String((b.promptFeedback as Obj | undefined)?.blockReason ?? cand?.finishReason ?? 'NO_ANSWER');
    return { ...base, status: 'failed', output: [], error: { code: reason, message: 'The model gave no answer.' } };
  }
  const output: Obj[] = [];
  const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text as string).join('');
  if (text) {
    output.push({ id: `msg_${randomUUID()}`, kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text, annotations: [] }] });
  }
  for (const p of parts) {
    const fc = p.functionCall as { name?: string; args?: Obj } | undefined;
    if (!fc?.name) continue;
    output.push({
      id: typeof p.thoughtSignature === 'string' ? `sig:${p.thoughtSignature}` : `fc_${randomUUID()}`,
      kind: 'output',
      type: 'function_call',
      callId: `call_${randomUUID()}`,
      name: fc.name,
      arguments: JSON.stringify(fc.args ?? {}),
      status: 'completed',
    });
  }
  const u = b.usageMetadata as Obj | undefined;
  const finish = String(cand.finishReason ?? 'STOP');
  return {
    ...base,
    status: finish === 'MAX_TOKENS' ? 'incomplete' : 'completed',
    ...(finish === 'MAX_TOKENS' && { incompleteDetails: { reason: 'max_output_tokens' as const } }),
    output,
    ...(u && {
      usage: { inputTokens: Number(u.promptTokenCount ?? 0), outputTokens: Number(u.candidatesTokenCount ?? 0), totalTokens: Number(u.totalTokenCount ?? 0) },
    }),
  };
}

/** Real ids (non-demo order, capture and dispute ids) found in a request body. Any hit means the request is refused. */
export function realDataIn(body: string, realIds: string[]): string[] {
  return realIds.filter((id) => id.length >= 6 && body.includes(id));
}
