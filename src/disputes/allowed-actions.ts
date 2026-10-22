// allowedActions (T-204): what the seller may do on a dispute right now, read from the links of a fresh
// GET and the allowed_response_options. The one gate the UI and the action service both use.
// Links are found by rel, never by position. A link we cannot trust allows nothing.
import type { Db } from '../lib/db';
import type { PayPalClient } from '../paypal/client';
import { DISPUTE_ID, DisputeParseError, parseDispute } from './parse';

export type ActionCode = 'ACCEPT_CLAIM' | 'PROVIDE_EVIDENCE' | 'PROVIDE_SUPPORTING_INFO' | 'SEND_MESSAGE' | 'ESCALATE';

/**
 * The only rels we act on, in the fixed order we return them. The sandbox-only rels (require_evidence,
 * adjudicate) and `self` are not here on purpose: they are never offered to a seller.
 */
const KNOWN: ReadonlyArray<{ action: ActionCode; rel: string; slug: string }> = [
  { action: 'ACCEPT_CLAIM', rel: 'accept_claim', slug: 'accept-claim' },
  { action: 'PROVIDE_EVIDENCE', rel: 'provide_evidence', slug: 'provide-evidence' },
  { action: 'PROVIDE_SUPPORTING_INFO', rel: 'provide_supporting_info', slug: 'provide-supporting-info' },
  { action: 'SEND_MESSAGE', rel: 'send_message', slug: 'send-message' },
  { action: 'ESCALATE', rel: 'escalate', slug: 'escalate' },
];

export interface AllowedAction {
  action: ActionCode;
  rel: string;
  method: 'POST';
  /** Path on PayPal's API for this dispute. The host is not kept; the client adds its own. */
  path: string;
}

export interface AllowedActions {
  actions: AllowedAction[];
  /** From allowed_response_options, and only when ACCEPT_CLAIM is allowed. Never guessed. */
  acceptClaimTypes: string[];
}

const EMPTY = (): AllowedActions => ({ actions: [], acceptClaimTypes: [] });
const TYPE_CODE = /^[A-Z][A-Z0-9_]{0,59}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The path of a link that is a plain https URL for exactly this action on this dispute, else null. */
function trustedPath(link: Record<string, unknown>, disputeId: string, slug: string): string | null {
  if (link.method !== 'POST' || typeof link.href !== 'string') return null;
  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  const path = `/v1/customer/disputes/${disputeId}/${slug}`;
  if (url.protocol !== 'https:' || url.pathname !== path || url.search !== '' || url.hash !== '') return null;
  return path;
}

/**
 * SANDBOX ONLY (T-402): the path of PayPal's `adjudicate` link, which stands in for PayPal's own decision.
 * It is never an allowed seller action and is only used by the sandbox settle step, behind DEMO_MODE.
 */
export function sandboxAdjudicatePath(details: unknown): string | null {
  if (!isObject(details) || typeof details.dispute_id !== 'string' || !DISPUTE_ID.test(details.dispute_id)) return null;
  const id = details.dispute_id;
  const mine = (Array.isArray(details.links) ? details.links.filter(isObject) : []).filter((l) => l.rel === 'adjudicate');
  if (mine.length === 0) return null;
  const paths = mine.map((l) => trustedPath(l, id, 'adjudicate'));
  return paths[0] != null && paths.every((x) => x === paths[0]) ? paths[0] : null;
}

export function allowedActions(details: unknown): AllowedActions {
  if (!isObject(details) || typeof details.dispute_id !== 'string' || !DISPUTE_ID.test(details.dispute_id))
    return EMPTY();
  const id = details.dispute_id;
  const links = Array.isArray(details.links) ? details.links.filter(isObject) : [];

  const actions: AllowedAction[] = [];
  for (const k of KNOWN) {
    const mine = links.filter((l) => l.rel === k.rel);
    if (mine.length === 0) continue;
    // Every link for this rel must be trusted and the same, or the action is refused.
    const paths = mine.map((l) => trustedPath(l, id, k.slug));
    const first = paths[0];
    if (first == null || paths.some((p) => p !== first)) continue;
    actions.push({ action: k.action, rel: k.rel, method: 'POST', path: first });
  }

  let acceptClaimTypes: string[] = [];
  if (actions.some((a) => a.action === 'ACCEPT_CLAIM')) {
    const opts = isObject(details.allowed_response_options) ? details.allowed_response_options : null;
    const accept = opts && isObject(opts.accept_claim) ? opts.accept_claim : null;
    const types = accept && Array.isArray(accept.accept_claim_types) ? accept.accept_claim_types : [];
    acceptClaimTypes = [...new Set(types.filter((t): t is string => typeof t === 'string' && TYPE_CODE.test(t)))];
  }
  return { actions, acceptClaimTypes };
}

export function hasAction(allowed: AllowedActions, action: ActionCode): boolean {
  return allowed.actions.some((a) => a.action === action);
}

export interface AllowedActionsDeps {
  db: Db;
  paypal: PayPalClient;
}

export interface FreshAllowedActions {
  disputeId: string;
  status: string;
  stage: string;
  /** Hash of the payload these actions came from, to see that the dispute has not changed (T-210). */
  rawHash: string;
  allowed: AllowedActions;
  /** Sandbox only: the adjudicate link, if PayPal shows one. Not a seller action. */
  sandboxAdjudicatePath: string | null;
}

/**
 * A fresh GET every call. Nothing is cached and nothing is read from the database: a stored copy
 * (see syncDispute) is for display only and can never widen what this returns.
 */
export async function getAllowedActions(deps: AllowedActionsDeps, disputeId: string): Promise<FreshAllowedActions> {
  if (!DISPUTE_ID.test(disputeId)) throw new Error('Not a dispute id');
  const res = await deps.paypal.get<unknown>(`/v1/customer/disputes/${encodeURIComponent(disputeId)}`);
  const d = parseDispute(res.body);
  if (d.paypalDisputeId !== disputeId) throw new DisputeParseError('PayPal returned a different dispute');
  return {
    disputeId,
    status: d.status,
    stage: d.stage,
    rawHash: d.rawHash,
    allowed: allowedActions(res.body),
    sandboxAdjudicatePath: sandboxAdjudicatePath(res.body),
  };
}
