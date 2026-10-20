// The four screens and the context (order, case) that navigation keeps.
export const SCREENS = [
  { key: 'overview', label: 'Overview' },
  { key: 'order', label: 'Order' },
  { key: 'dispute', label: 'Dispute' },
  { key: 'outcome', label: 'Outcome' },
] as const;

export interface ScreenContext {
  orderId?: string;
  caseId?: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const clean = (v: string | null | undefined) => (v && ID.test(v) ? v : undefined);

/** Reads the order and case ids from the URL: the path id for the current screen, the query for the other. */
export function contextFromLocation(pathname: string, query: URLSearchParams): ScreenContext {
  const [, area, id] = pathname.split('/');
  let orderId = clean(query.get('order'));
  let caseId = clean(query.get('case'));
  if (area === 'orders') orderId = clean(id) ?? undefined;
  if (area === 'disputes' || area === 'outcome') caseId = clean(id) ?? undefined;
  const out: ScreenContext = {};
  if (orderId) out.orderId = orderId;
  if (caseId) out.caseId = caseId;
  return out;
}

const qs = (pairs: [string, string | undefined][]) => {
  const p = pairs.filter((x): x is [string, string] => !!x[1]);
  return p.length ? `?${p.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : '';
};

/** A link per screen, in order. null means the id that screen needs is not known yet. */
export function screenLinks(
  ctx: ScreenContext,
): { key: (typeof SCREENS)[number]['key']; label: string; href: string | null }[] {
  const { orderId, caseId } = ctx;
  const href: Record<(typeof SCREENS)[number]['key'], string | null> = {
    overview: `/overview${qs([
      ['order', orderId],
      ['case', caseId],
    ])}`,
    order: orderId ? `/orders/${encodeURIComponent(orderId)}${qs([['case', caseId]])}` : null,
    dispute: caseId ? `/disputes/${encodeURIComponent(caseId)}${qs([['order', orderId]])}` : null,
    outcome: caseId ? `/outcome/${encodeURIComponent(caseId)}${qs([['order', orderId]])}` : null,
  };
  return SCREENS.map((s) => ({ ...s, href: href[s.key] }));
}
