// The inbox as rows and columns for the one grid wrapper. Plain data only: the page is a server component.
import type { GridColumn } from '../components/grid-columns';
import type { GridRow } from '../components/data-grid';
import { ageText, deadlineText, humanise, type InboxRow } from './inbox';

export const INBOX_COLUMNS: GridColumn[] = [
  { kind: 'link', field: 'dispute', hrefField: 'href', header: 'Dispute' },
  { kind: 'text', field: 'reason', header: 'Reason' },
  { kind: 'text', field: 'stage', header: 'Stage' },
  { kind: 'text', field: 'status', header: 'Status' },
  { kind: 'money', field: 'amountMinor', currencyField: 'currency', header: 'Amount' },
  { kind: 'truth', field: 'truthState', header: 'Source' },
  { kind: 'text', field: 'deadline', header: 'Respond by' },
  { kind: 'freshness', field: 'freshness', header: 'Sync' },
  { kind: 'text', field: 'synced', header: 'Last synced' },
  { kind: 'text', field: 'order', header: 'Order' },
];

export function inboxGridRows(rows: InboxRow[], now: Date): GridRow[] {
  return rows.map((r) => ({
    id: r.id,
    dispute: r.disputeId,
    href: `/disputes/${encodeURIComponent(r.id)}${r.orderId ? `?order=${encodeURIComponent(r.orderId)}` : ''}`,
    reason: humanise(r.reason),
    stage: humanise(r.stage),
    status: humanise(r.status),
    amountMinor: r.amountMinor,
    currency: r.currency,
    truthState: r.truthState,
    deadline: deadlineText(r.deadline, now),
    freshness: r.stale ? 'Stale' : 'Fresh',
    synced: ageText(r.ageSeconds),
    order: r.orderId ? 'Linked' : 'No order found',
  }));
}
