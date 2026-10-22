// The server half of AG Studio's AI assistant (T-405, owner decision 22 Oct: demo data only). The browser adapter
// posts Studio's request here; we call Gemini with the key, which never leaves the server, and answer in Studio's
// shape. CLAUDE.md: only synthetic demo data may reach the AI provider. The dashboard loads demo rows only while
// the assistant is on, and this route refuses any request that carries a real order, capture or dispute id.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../lib/db';
import { fromGemini, realDataIn, toGemini, type StudioRequest, type StudioResponse } from './studio-gemini';

export type StudioAi = { kind: 'gemini'; apiKey: string; model: string } | { kind: 'fixture' };
export interface StudioAiDeps {
  db: Db;
  ai: StudioAi | null;
  dailyCap?: number;
  timeoutMs?: number;
}

const Body = z.object({
  input: z.array(z.object({ type: z.string() }).passthrough()).max(200),
  instructions: z.string().max(100_000).optional(),
  tools: z.array(z.object({ name: z.string(), description: z.string(), parameters: z.record(z.string(), z.unknown()) })).max(100).optional(),
  toolChoice: z.union([z.enum(['auto', 'none', 'required']), z.object({ name: z.string() })]).optional(),
  responseFormat: z.union([
    z.object({ type: z.literal('text') }),
    z.object({ type: z.literal('json'), name: z.string(), schema: z.record(z.string(), z.unknown()) }),
  ]),
});
const RUN = 'studio-ai';
const MAX_BODY = 600_000;

async function realIds(db: Db): Promise<string[]> {
  const [orders, cases] = await Promise.all([
    db.order.findMany({ where: { NOT: { paypalOrderId: { startsWith: 'DEMO-' } } }, select: { paypalOrderId: true, captureId: true } }),
    db.disputeCase.findMany({ where: { NOT: { paypalDisputeId: { startsWith: 'PP-DEMO-' } } }, select: { paypalDisputeId: true } }),
  ]);
  return [...orders.flatMap((o) => [o.paypalOrderId, o.captureId ?? '']), ...cases.map((c) => c.paypalDisputeId)].filter(Boolean);
}

const fixture = (): StudioResponse => ({
  id: 'resp_fixture',
  createdAt: Math.floor(Date.now() / 1000),
  status: 'completed',
  model: 'fixture-1',
  output: [{ id: 'msg_fixture', kind: 'output', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'text', text: 'Fixture answer for tests.', annotations: [] }] }],
});

export async function handleStudioAi(deps: StudioAiDeps, raw: unknown): Promise<Response> {
  if (!deps.ai) return Response.json({ error: 'AI_OFF' }, { status: 503 });
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return Response.json({ error: 'BAD_REQUEST' }, { status: 400 });
  const text = JSON.stringify(parsed.data);
  if (text.length > MAX_BODY) return Response.json({ error: 'TOO_LARGE' }, { status: 413 });
  if (realDataIn(text, await realIds(deps.db)).length > 0) return Response.json({ error: 'REAL_DATA' }, { status: 403 });

  if (deps.dailyCap !== undefined) {
    const since = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    if ((await deps.db.agentRun.count({ where: { caseId: RUN, createdAt: { gte: since } } })) >= deps.dailyCap)
      return Response.json({ error: 'DAILY_CAP' }, { status: 429 });
  }

  const started = Date.now();
  const ai = deps.ai;
  let answer: StudioResponse;
  let validation = 'PASS';
  let status = 200;
  if (ai.kind === 'fixture') answer = fixture();
  else {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 45_000);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent`, {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': ai.apiKey },
        body: JSON.stringify(toGemini(parsed.data as unknown as StudioRequest)),
      });
      if (!res.ok) {
        validation = `FAILED: HTTP ${res.status}`;
        status = 502;
        answer = { id: 'resp_error', createdAt: Math.floor(Date.now() / 1000), status: 'failed', output: [], error: { code: `HTTP_${res.status}`, message: 'The model could not answer.' } };
      } else {
        answer = fromGemini(await res.json(), ai.model);
        if (answer.status === 'failed') validation = `FAILED: ${answer.error?.code ?? 'NO_ANSWER'}`;
      }
    } catch (e) {
      validation = ctl.signal.aborted ? 'FAILED: TIMEOUT' : 'FAILED: NETWORK';
      status = 504;
      answer = { id: 'resp_error', createdAt: Math.floor(Date.now() / 1000), status: 'failed', output: [], error: { code: ctl.signal.aborted ? 'TIMEOUT' : 'NETWORK', message: 'The model could not be reached.' } };
      void e;
    } finally {
      clearTimeout(timer);
    }
  }
  await deps.db.agentRun.create({
    data: {
      caseId: RUN,
      mode: 'AI',
      provider: ai.kind,
      model: ai.kind === 'gemini' ? ai.model : 'fixture-1',
      inputHash: createHash('sha256').update(text).digest('hex'),
      outputJson: JSON.stringify(answer).slice(0, 20_000),
      validation,
      latencyMs: Date.now() - started,
    },
  });
  return Response.json(answer, { status });
}
