// Rules engine, Stage A (T-302): the baseline recommendation from the PRD decision table (section 5).
// It reads only the case file and the clock it is given. It never calls PayPal and never reads the buyer's words
// to decide (R13): a buyer message can only tell us that the buyer wrote something. Works with the AI switched off.
import type { CaseFile, CaseFileEvidence } from '../case/case-file';
import type { Action, Analysis, Claim } from '../ai/schema';

export type Flag = 'DEADLINE_URGENT' | 'DEADLINE_PASSED' | 'REVIEW_BEFORE_DECIDING' | 'REFUND_OPTION';
export interface ChecklistItem {
  type: string;
  supportable: boolean;
  reason: string;
}
export interface RulesResult {
  recommendedAction: Action;
  approvalRequired: boolean;
  urgent: boolean;
  flags: Flag[];
  /** Only while the seller can act. Hours are whole hours, rounded down; negative once passed. */
  deadline: { at: string; hoursLeft: number; passed: boolean; inKolkata: string } | null;
  checklist: ChecklistItem[];
  /** Requested evidence types the records cannot support. Never invented. */
  missing: string[];
  /** R10: shown beside the recommendation, with what the seller would give up. */
  refundOption: { minor: number; currency: string } | null;
  analysis: Analysis;
}

const WRITES: readonly Action[] = ['ACCEPT_CLAIM', 'PROVIDE_EVIDENCE', 'PROVIDE_SUPPORTING_INFO', 'SEND_MESSAGE', 'ESCALATE'];
const day = (iso: string) => iso.slice(0, 10);
const HOUR = 3_600_000;

function deadlineOf(cf: CaseFile, asOf: Date): RulesResult['deadline'] {
  if (!cf.dispute.sellerDeadline || cf.allowedActions.actions.length === 0) return null;
  const at = new Date(cf.dispute.sellerDeadline);
  const hoursLeft = Math.floor((at.getTime() - asOf.getTime()) / HOUR);
  const inKolkata = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(at);
  return { at: at.toISOString(), hoursLeft, passed: at.getTime() <= asOf.getTime(), inKolkata };
}

/** Only a shipment with a tracking number supports proof of fulfilment. Nothing else is supportable (no signature record exists). */
function checklistOf(cf: CaseFile, shipment: CaseFileEvidence | undefined): ChecklistItem[] {
  return cf.dispute.requestedEvidence.map((type) => {
    if (type === 'PROOF_OF_FULFILLMENT') {
      const ok = !!shipment && !!shipment.fields.trackingNo;
      return { type, supportable: ok, reason: ok ? 'shipment record with a tracking number' : 'no shipment record with a tracking number' };
    }
    if (type === 'PROOF_OF_DELIVERY_SIGNATURE') return { type, supportable: false, reason: 'the app holds no signature record' };
    return { type, supportable: false, reason: 'the app holds no record of this type' };
  });
}

function claimsFor(cf: CaseFile, shipment: CaseFileEvidence | undefined, withLatestEvent: boolean) {
  const claims: Claim[] = [];
  const lines: string[] = [];
  if (shipment?.fields.trackingNo) {
    const carrier = String(shipment.fields.carrier);
    const trackingNo = String(shipment.fields.trackingNo);
    const date = day(shipment.occurredAt);
    claims.push({ id: 'c-shipped', type: 'SHIPPED', carrier, trackingNo, date, recordIds: [shipment.id] });
    lines.push(`Your order was shipped on ${date} with ${carrier.replace(/_/g, ' ')}, tracking number ${trackingNo}.`);
  }
  if (withLatestEvent) {
    // A carrier event labelled Unknown never supports a claim (Q3), so only trusted events are quoted.
    const events = cf.evidence
      .filter((e) => e.type === 'TRACKING_EVENT' && e.trustState !== 'Unknown')
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const last = events[events.length - 1];
    if (last) {
      const status = String(last.fields.status);
      const date = day(last.occurredAt);
      if (status === 'DELIVERED') {
        claims.push({ id: 'c-event', type: 'DELIVERED', date, recordIds: [last.id] });
        lines.push(`Our tracking record shows the parcel was delivered on ${date}.`);
      } else if (status === 'DELIVERED_TO_NEIGHBOUR') {
        claims.push({ id: 'c-event', type: 'DELIVERED_TO_NEIGHBOUR', date, recordIds: [last.id] });
        lines.push(`Our tracking record shows the parcel was delivered to a neighbour on ${date}.`);
      } else {
        claims.push({ id: 'c-event', type: 'TRACKING_STATUS', status, date, recordIds: [last.id] });
        lines.push(`The latest tracking status is ${status.replace(/_/g, ' ').toLowerCase()} (${date}).`);
      }
    }
  }
  return { claims, lines };
}

export function runRules(cf: CaseFile, asOf: Date): RulesResult {
  const actions = cf.allowedActions.actions;
  const has = (a: string) => (actions as string[]).includes(a);
  const shipment = cf.evidence.find((e) => e.type === 'SHIPMENT');
  const checklist = checklistOf(cf, shipment);
  const supportable = checklist.filter((c) => c.supportable);
  const missing = checklist.filter((c) => !c.supportable).map((c) => c.type);
  const deadline = deadlineOf(cf, asOf);
  const inquiry = cf.dispute.stage === 'INQUIRY';

  let action: Action = 'NO_ACTION';
  let summary = '';
  let withEvent = false;

  if (cf.dispute.status === 'RESOLVED') {
    summary = 'The dispute is resolved. No action is needed.'; // R1
  } else if (actions.length === 0) {
    const waiting = cf.dispute.status === 'UNDER_REVIEW' || cf.dispute.status === 'WAITING_FOR_BUYER_RESPONSE';
    action = waiting ? 'WAIT' : 'NO_ACTION'; // R2 over R1
    summary = waiting ? 'PayPal is not asking you for anything. Wait for the buyer or for PayPal.' : 'PayPal offers no action on this dispute.';
  } else if (inquiry) {
    if (has('SEND_MESSAGE') && shipment) {
      action = 'SEND_MESSAGE'; // R4, R5
      withEvent = true;
      summary = 'Reply to the buyer with the shipping details you can back with records.';
    } else if (!shipment) {
      summary = 'No shipment is recorded. Add the shipment details to the order first; nothing about delivery can be claimed without them.'; // R6
    } else {
      summary = 'PayPal does not offer a message at this stage.';
    }
  } else if (has('PROVIDE_EVIDENCE')) {
    if (supportable.length) {
      action = 'PROVIDE_EVIDENCE'; // R7
      summary = `Submit evidence for what the records support: ${supportable.map((s) => s.type).join(', ')}.${
        missing.length ? ` Not supportable, so not claimed: ${missing.join(', ')}.` : ''
      }`;
    } else {
      summary = 'None of the requested evidence can be backed by your records. Add the missing records first.'; // R8
    }
  } else if (has('PROVIDE_SUPPORTING_INFO') && !has('ACCEPT_CLAIM')) {
    if (shipment && cf.buyerMessages.length) {
      action = 'PROVIDE_SUPPORTING_INFO'; // R14
      summary = 'Answer the buyer with information your records support.';
      withEvent = true;
    } else {
      action = 'WAIT';
      summary = 'Nothing in your records answers the buyer. Wait.';
    }
  } else if (has('ACCEPT_CLAIM')) {
    if (supportable.length) {
      summary = 'Your records could support evidence, but PayPal is not offering it. Sync the case again and check whether PayPal now offers PROVIDE_EVIDENCE.'; // R15
    } else {
      action = 'ACCEPT_CLAIM'; // R8, only action
      summary = 'The requested evidence cannot be backed by your records and accepting is the only action PayPal offers.';
    }
  } else {
    summary = 'No recommended action.';
  }

  const flags: Flag[] = [];
  let urgent = false;
  if (deadline && deadline.hoursLeft < 24) {
    urgent = true;
    flags.push(deadline.passed ? 'DEADLINE_PASSED' : 'DEADLINE_URGENT');
    if (deadline.passed) {
      summary = `The deadline has passed (${deadline.inKolkata} IST). Sync now: PayPal may still offer this action. ${summary}`; // R3
    } else {
      summary = `${deadline.hoursLeft} hours left (due ${deadline.inKolkata} IST). ${summary}`;
    }
  }
  const { minor, currency } = cf.dispute.amount;
  let refundOption: RulesResult['refundOption'] = null;
  if (actions.length && cf.policy) {
    if (minor >= cf.policy.highValueBandMinor) flags.push('REVIEW_BEFORE_DECIDING'); // R9
    if (has('ACCEPT_CLAIM') && minor <= cf.policy.refundThresholdMinor) {
      flags.push('REFUND_OPTION'); // R10
      refundOption = { minor, currency };
    }
  }

  const { claims, lines } =
    action === 'SEND_MESSAGE' || action === 'PROVIDE_SUPPORTING_INFO' || action === 'PROVIDE_EVIDENCE'
      ? claimsFor(cf, shipment, withEvent)
      : { claims: [], lines: [] };
  const drafts = action === 'SEND_MESSAGE' || action === 'PROVIDE_SUPPORTING_INFO';
  const analysis: Analysis = {
    recommendedAction: action,
    approvalRequired: (WRITES as readonly string[]).includes(action),
    urgent,
    summary: summary.slice(0, 1000),
    claims,
    draft: drafts && lines.length ? { text: `Hello, ${lines.join(' ')}`, claimIds: claims.map((c) => c.id) } : null,
  };

  return {
    recommendedAction: action,
    approvalRequired: analysis.approvalRequired,
    urgent,
    flags,
    deadline,
    checklist,
    missing,
    refundOption,
    analysis,
  };
}
