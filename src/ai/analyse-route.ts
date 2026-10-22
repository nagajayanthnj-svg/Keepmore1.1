// The analyse route (T-308): streams NDJSON. Line 1 is the rules answer (Stage A, at once); line 2 the result after
// the model (Stage B, up to 45 s) or the rules fallback. The UI shows the rules draft straight away.
// Allowed actions: a fresh GET for a real dispute (never the stored copy); the stored copy for a demo case, labelled
// Simulated demo; none when PayPal cannot be reached. Real buyer text is never sent to the model (demo only).
import { buildCaseFile } from '../case/case-file';
import { DEMO_DISPUTE_PREFIX } from '../demo/disputes';
import { getAllowedActions, type ActionCode } from '../disputes/allowed-actions';
import { DISPUTE_ID } from '../disputes/parse';
import type { Db } from '../lib/db';
import type { PayPalClient } from '../paypal/client';
import { runRules, type RulesResult } from '../rules/rules';
import type { AnalyseResult } from './adapter';
import type { Gated } from './gate';
import { analyseAndGate } from './pipeline';
import type { AiProvider } from './provider';
import type { Analysis } from './schema';
import { validateClaims, type ClaimCheck } from './validate-claims';

export interface AnalyseRouteDeps {
  db: Db;
  paypal: PayPalClient | null;
  provider: AiProvider | null;
  now?: () => Date;
  dailyCap?: number;
  timeoutMs?: number;
  /** DEMO_MODE: lets the screen offer the sandbox settle step (T-402). */
  demoMode?: boolean;
}

export type AllowedSource = 'PAYPAL' | 'SIMULATED' | 'UNAVAILABLE';
export type AnalyseEvent =
  | { type: 'rules'; rules: RulesResult }
  | {
      type: 'result';
      mode: AnalyseResult['mode'];
      label: string | null;
      analysis: Analysis;
      gated: Gated;
      claims: ClaimCheck[];
      hallucinatedCitations: string[];
      allowed: { source: AllowedSource; actions: ActionCode[] };
      /** Sandbox only, DEMO_MODE on: whether PayPal shows the adjudicate link now. Null otherwise. */
      sandboxSettle: 'OFFERED' | 'NOT_YET' | null;
    }
  | { type: 'error'; error: 'INTERNAL' };

const line = (e: AnalyseEvent) => new TextEncoder().encode(JSON.stringify(e) + '\n');

export async function handleAnalyse(deps: AnalyseRouteDeps, disputeId: string): Promise<Response> {
  if (!DISPUTE_ID.test(disputeId)) return Response.json({ error: 'BAD_DISPUTE_ID' }, { status: 400 });
  const row = await deps.db.disputeCase.findUnique({ where: { paypalDisputeId: disputeId } });
  if (!row) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  const cf = await buildCaseFile(deps.db, row.id);
  if (!cf) return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  const asOf = (deps.now ?? (() => new Date()))();
  const demo = disputeId.startsWith(DEMO_DISPUTE_PREFIX);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(line({ type: 'rules', rules: runRules(cf, asOf) }));

        let allowed: { source: AllowedSource; actions: ActionCode[] };
        let sandboxSettle: 'OFFERED' | 'NOT_YET' | null = null;
        if (demo) allowed = { source: 'SIMULATED', actions: [...cf.allowedActions.actions] };
        else if (!deps.paypal) allowed = { source: 'UNAVAILABLE', actions: [] };
        else {
          try {
            const fresh = await getAllowedActions({ db: deps.db, paypal: deps.paypal }, disputeId);
            allowed = { source: 'PAYPAL', actions: fresh.allowed.actions.map((a) => a.action) };
            if (deps.demoMode) sandboxSettle = fresh.sandboxAdjudicatePath ? 'OFFERED' : 'NOT_YET';
          } catch {
            allowed = { source: 'UNAVAILABLE', actions: [] };
          }
        }

        const { result, gated } = await analyseAndGate(
          deps.db,
          cf,
          deps.provider,
          { asOf, syntheticData: demo, dailyCap: deps.dailyCap, timeoutMs: deps.timeoutMs },
          allowed.actions,
        );
        const v = result.validation ?? validateClaims(result.analysis, cf);
        controller.enqueue(
          line({
            type: 'result',
            mode: result.mode,
            label: result.label,
            analysis: result.analysis,
            gated,
            claims: v.results,
            hallucinatedCitations: v.hallucinatedCitations,
            allowed,
            sandboxSettle,
          }),
        );
      } catch (e) {
        console.error(`analyse ${disputeId} failed: ${e instanceof Error ? e.message : String(e)}`);
        controller.enqueue(line({ type: 'error', error: 'INTERNAL' }));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
}
