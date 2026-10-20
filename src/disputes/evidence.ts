// Evidence records (T-207): the facts a dispute case can cite, each with a stable REC id.
// Built from our own database on demand. Nothing is invented: a missing source makes no record.
// No email, name, address, payer id or buyer hash goes into a record.
import { createHash } from 'node:crypto';
import type { Db } from '../lib/db';
import type { TruthState } from '../lib/truth-state';
import { CANONICAL_STATUSES } from '../normalise/carrier-status';

export type EvidenceType = 'ORDER' | 'CAPTURE' | 'SHIPMENT' | 'TRACKING_EVENT';
// BUYER_MESSAGE and POLICY (in the data model) are not built yet: messages are not stored, and a policy has no date.

export interface EvidenceRecordView {
  id: string;
  caseId: string;
  type: EvidenceType;
  source: string;
  occurredAt: Date;
  fields: Record<string, unknown>;
  contentHash: string;
  trustState: TruthState;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canonical(x)]),
    );
  }
  return v;
}

/** Same case, type and source key: same id, whatever the content. The key says which fact it is, not what it says. */
const recId = (caseId: string, type: EvidenceType, key: string) =>
  `REC-${sha256(`${caseId}|${type}|${key}`).slice(0, 10).toUpperCase()}`;

function parseItems(json: string): { sku: string; qty: number; unitMinor: number }[] {
  try {
    const v: unknown = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v.flatMap((i) => {
      const { sku, qty, unitMinor } = (i ?? {}) as Record<string, unknown>;
      return typeof sku === 'string' && Number.isInteger(qty) && Number.isInteger(unitMinor)
        ? [{ sku, qty: qty as number, unitMinor: unitMinor as number }]
        : [];
    });
  } catch {
    return [];
  }
}

type Draft = Omit<EvidenceRecordView, 'id' | 'contentHash' | 'caseId'> & { key: string };

interface TrackingEvent {
  at: Date;
  status: string;
  source: string;
}

/** Events that have a real time; the status must be one of ours, else UNKNOWN (never a guess). */
function parseEvents(json: string): TrackingEvent[] {
  let v: unknown;
  try {
    v = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  const out: TrackingEvent[] = [];
  for (const e of v) {
    const { at, status, source } = (e ?? {}) as Record<string, unknown>;
    if (typeof at !== 'string' || typeof status !== 'string') continue;
    const when = new Date(at);
    if (Number.isNaN(when.getTime())) continue;
    out.push({
      at: when,
      status: (CANONICAL_STATUSES as readonly string[]).includes(status) ? status : 'UNKNOWN',
      source: typeof source === 'string' ? source : '',
    });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.status < b.status ? -1 : 1));
}

/**
 * Rebuilds the records of one case from the order, capture and shipment it is linked to, keeps the
 * ids of those that already exist, updates their content, and removes those whose source is gone.
 */
export async function syncEvidenceRecords(db: Db, caseId: string): Promise<EvidenceRecordView[]> {
  const theCase = await db.disputeCase.findUnique({ where: { id: caseId }, select: { orderId: true } });
  if (!theCase?.orderId) return [];
  const order = await db.order.findUnique({ where: { id: theCase.orderId }, include: { shipment: true } });
  if (!order) return [];

  const demo = order.paypalOrderId.startsWith('DEMO-');
  const trust = (real: TruthState): TruthState => (demo ? 'Simulated demo' : real);
  const records: Draft[] = [];
  const add = (key: string, r: Omit<Draft, 'key'>) => records.push({ ...r, key });

  add(`order:${order.id}`, {
    type: 'ORDER',
    source: 'KEEPMORE',
    occurredAt: order.createdAt,
    fields: {
      country: order.country,
      grossMinor: order.grossMinor,
      currency: order.currency,
      items: parseItems(order.itemsJson),
    },
    trustState: trust('Seller entered'),
  });

  if (order.captureId) {
    const gross = await db.ledgerEntry.findFirst({
      where: { orderId: order.id, type: 'GROSS', sourceRef: order.captureId },
      orderBy: { occurredAt: 'asc' },
    });
    add(`capture:${order.captureId}`, {
      type: 'CAPTURE',
      source: demo ? 'KEEPMORE_DEMO' : 'PAYPAL',
      occurredAt: gross?.occurredAt ?? order.createdAt,
      fields: {
        captureId: order.captureId,
        grossMinor: order.grossMinor,
        currency: order.currency,
        sellerProtection: order.sellerProtection,
      },
      trustState: trust('Verified by PayPal'),
    });
  }

  const s = order.shipment;
  if (s) {
    add(`shipment:${s.id}`, {
      type: 'SHIPMENT',
      source: 'SELLER',
      // The shipment has no date of its own: the push time when there is one, else the order's date.
      occurredAt: s.pushedToPaypalAt ?? order.createdAt,
      fields: { carrier: s.carrier, trackingNo: s.trackingNo, pushStatus: s.pushStatus },
      trustState: trust('Seller entered'),
    });
    for (const e of parseEvents(s.eventsJson)) {
      add(`event:${s.id}:${e.at.toISOString()}:${e.status}`, {
        type: 'TRACKING_EVENT',
        source: e.source || 'UNKNOWN',
        occurredAt: e.at,
        fields: { carrier: s.carrier, status: e.status },
        trustState: trust(
          e.source === 'SELLER' ? 'Seller entered' : e.source === 'DEMO' ? 'Simulated demo' : 'Unknown',
        ),
      });
    }
  }

  const views: EvidenceRecordView[] = records.map(({ key, ...r }) => ({
    ...r,
    caseId,
    id: recId(caseId, r.type, key),
    contentHash: sha256(
      JSON.stringify(
        canonical({
          type: r.type,
          source: r.source,
          occurredAt: r.occurredAt.toISOString(),
          fields: r.fields,
          trustState: r.trustState,
        }),
      ),
    ),
  }));

  const ids = views.map((v) => v.id);
  await db.$transaction([
    db.evidenceRecord.deleteMany({ where: { caseId, id: { notIn: ids } } }),
    ...views.map((v) => {
      const data = {
        caseId,
        type: v.type,
        source: v.source,
        occurredAt: v.occurredAt,
        fieldsJson: JSON.stringify(canonical(v.fields)),
        contentHash: v.contentHash,
        trustState: v.trustState,
      };
      return db.evidenceRecord.upsert({ where: { id: v.id }, create: { id: v.id, ...data }, update: data });
    }),
  ]);
  return views.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.id < b.id ? -1 : 1));
}
