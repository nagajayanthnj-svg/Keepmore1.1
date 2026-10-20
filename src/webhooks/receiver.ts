// Webhook receiver (T-202): verify, deduplicate on event id, then ask for a dispute sync.
// It decides nothing about disputes. Webhooks are a nudge, not the truth: some changes send none
// (Phase 0), so the poller (T-205) is required alongside.
import { DISPUTE_ID } from '../disputes/parse';
import type { Db } from '../lib/db';
import { systemClock, type Clock } from '../lib/clock';

export interface WebhookDeps {
  db: Db;
  /** True when PayPal confirms the signature. Throws when PayPal cannot be asked. */
  verify: (headers: Headers, rawBody: string) => Promise<boolean>;
  /** Re-reads one dispute from PayPal (T-203). Absent until that exists. */
  syncDispute?: (disputeId: string) => Promise<void>;
  /** Runs work after the response has gone out (Next's `after`). */
  defer: (work: Promise<unknown>) => void;
  clock?: Clock;
}

const EVENT_ID = /^[A-Za-z0-9_-]{1,100}$/;
const EVENT_TYPE = /^[A-Za-z0-9_.]{1,100}$/;

const json = (body: unknown, status: number) => Response.json(body, { status });
const clip = (s: string) => s.slice(0, 300);

interface WebhookEvent {
  id?: unknown;
  event_type?: unknown;
  resource?: { dispute_id?: unknown };
}

type Claim = 'NEW' | 'UPGRADED' | 'EXISTS';

/**
 * Takes the event id. Only a verified delivery can use it up: an unverified row (a forgery reusing a
 * real id) is upgraded by the genuine delivery instead of blocking it. Safe under concurrent copies.
 */
async function claim(db: Db, eventId: string, type: string, verified: boolean, now: Date): Promise<Claim> {
  try {
    await db.webhookEvent.create({
      data: { eventId, type, verified, receivedAt: now, result: verified ? null : 'UNVERIFIED' },
    });
    return 'NEW';
  } catch (e) {
    const existing = await db.webhookEvent.findUnique({ where: { eventId } });
    if (!existing) throw e;
    if (verified && !existing.verified) {
      const r = await db.webhookEvent.updateMany({
        where: { eventId, verified: false },
        data: { verified: true, type, result: null },
      });
      return r.count === 1 ? 'UPGRADED' : 'EXISTS';
    }
    return 'EXISTS';
  }
}

export async function handleWebhook(req: Request, deps: WebhookDeps): Promise<Response> {
  const raw = await req.text();
  let event: WebhookEvent | null = null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) event = parsed as WebhookEvent;
  } catch {
    // falls through to 400
  }
  const id = event?.id;
  const type = event?.event_type;
  if (typeof id !== 'string' || !EVENT_ID.test(id) || typeof type !== 'string' || !EVENT_TYPE.test(type)) {
    return json({ error: 'INVALID_EVENT' }, 400);
  }

  let verified: boolean;
  try {
    verified = await deps.verify(req.headers, raw);
  } catch (e) {
    // Not "invalid": PayPal could not be asked. Store nothing and let PayPal deliver it again.
    console.error(`webhook ${id}: could not verify: ${e instanceof Error ? e.message : 'unknown error'}`);
    return json({ error: 'VERIFY_UNAVAILABLE' }, 503);
  }

  const clock = deps.clock ?? systemClock;
  const taken = await claim(deps.db, id, type, verified, clock());
  if (!verified) return json({ error: 'INVALID_SIGNATURE' }, 401);
  if (taken === 'EXISTS') return json({ status: 'DUPLICATE' }, 200);

  const disputeId = event?.resource?.dispute_id;
  const finish = (data: { processedAt?: Date; result: string }) =>
    deps.db.webhookEvent.update({ where: { eventId: id }, data });
  deps.defer(
    (async () => {
      try {
        let result: string;
        if (!type.startsWith('CUSTOMER.DISPUTE.')) result = 'IGNORED_TYPE';
        else if (typeof disputeId !== 'string' || !DISPUTE_ID.test(disputeId)) result = 'IGNORED_BAD_ID';
        else if (!deps.syncDispute) result = 'NO_SYNC_AVAILABLE';
        else {
          await deps.syncDispute(disputeId);
          result = 'SYNC_REQUESTED';
        }
        await finish({ processedAt: clock(), result });
      } catch (e) {
        // The event stays deduplicated; the poller is the safety net for a failed sync.
        const message = e instanceof Error ? e.message : 'unknown error';
        await finish({ result: clip(`ERROR: ${message}`) }).catch((err) => console.error(`webhook ${id}: ${err}`));
      }
    })(),
  );
  return json({ status: 'ACCEPTED' }, 200);
}
