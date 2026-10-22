// TEST ONLY (decision 7, 22 Oct): canned model answers for Playwright, so the AI path is tested without a model.
// Turned on by AI_PROVIDER=fixture plus KEEPMORE_E2E=1, never in production (see providerFromEnv). It reads the
// case facts from the prompt and answers with one SUPPORTED claim and one unverified claim that its draft rests on,
// so the screen must show the unverified claim apart and hold the draft back.
import type { AiPrompt, AiProvider } from './provider';

interface Facts {
  dispute?: { stage?: string };
  allowedActions?: { actions?: string[] };
  evidence?: Array<{ id: string; type: string; occurredAt: string; fields: Record<string, unknown> }>;
}

export class FixtureProvider implements AiProvider {
  readonly name = 'fixture';
  readonly model = 'fixture-1';

  async generate(prompt: AiPrompt): Promise<string> {
    const m = /<case_facts>\s*([\s\S]*?)\s*<\/case_facts>/.exec(prompt.user);
    const facts = (m ? JSON.parse(m[1]!) : {}) as Facts;
    const allowed = facts.allowedActions?.actions ?? [];
    const ship = facts.evidence?.find((e) => e.type === 'SHIPMENT');
    const action =
      facts.dispute?.stage === 'CHARGEBACK' && allowed.includes('PROVIDE_EVIDENCE')
        ? 'PROVIDE_EVIDENCE'
        : allowed.includes('SEND_MESSAGE') && ship
          ? 'SEND_MESSAGE'
          : 'NO_ACTION';
    const claims = ship
      ? [
          {
            id: 'fx-shipped',
            type: 'SHIPPED',
            carrier: String(ship.fields.carrier),
            trackingNo: String(ship.fields.trackingNo),
            date: ship.occurredAt.slice(0, 10),
            recordIds: [ship.id],
          },
          { id: 'fx-signed', type: 'UNTYPED', text: 'The parcel was signed for by the buyer', recordIds: [ship.id] },
        ]
      : [];
    return JSON.stringify({
      recommendedAction: action,
      approvalRequired: action !== 'NO_ACTION',
      urgent: false,
      summary: 'Fixture answer for tests.',
      claims,
      draft: action === 'SEND_MESSAGE' ? { text: 'Hello, your parcel was signed for by you.', claimIds: claims.map((c) => c.id) } : null,
    });
  }
}
