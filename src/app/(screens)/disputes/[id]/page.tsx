import Link from 'next/link';
import { StaleBadge } from '../../../../components/stale-badge';
import { TruthStateBadge } from '../../../../components/truth-state-badge';
import { Workbench } from '../../../../components/workbench/workbench';
import { humanise } from '../../../../components/workbench/labels';
import { loadWorkbench } from '../../../../disputes/workbench';
import { fromMinor } from '../../../../normalise/money';
import { getDb } from '../../../../lib/server-deps';

export const metadata = { title: 'Dispute · KeepMore' };
export const dynamic = 'force-dynamic';

const ist = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

// Whose move it is, by colour and a filled dot; the words carry the same meaning.
const statusLook = (status: string) =>
  status === 'WAITING_FOR_SELLER_RESPONSE'
    ? 'border-amber-300 bg-amber-50 text-amber-950 before:h-2 before:w-2 before:rounded-full before:bg-amber-500'
    : status === 'RESOLVED'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-950 before:h-2 before:w-2 before:rounded-full before:bg-emerald-600'
      : 'before:h-2 before:w-2 before:rounded-full before:bg-slate-400';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let view = null;
  try {
    view = await loadWorkbench(getDb(), id, new Date());
  } catch {
    view = null; // database not set up: say so below rather than crash
  }
  if (!view) {
    return (
      <>
        <h1 className="km-title">Dispute not found</h1>
        <p className="km-lede">
          No dispute with that id is stored here. <Link className="km-link" href="/disputes">Back to the inbox</Link>.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="km-title">Dispute {view.disputeId}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="case-header">
        <span className="km-chip">{humanise(view.reason)}</span>
        <span className="km-chip" data-testid="stage">{view.stage}</span>
        <span className={`km-chip ${statusLook(view.status)}`} data-testid="status">
          {humanise(view.status)}
        </span>
        <span className="km-chip font-semibold">
          {fromMinor(view.amountMinor, view.currency)} {view.currency}
          <TruthStateBadge state={view.truthState} />
        </span>
        <StaleBadge state={view.stale ? 'Stale' : 'Fresh'} />
      </div>
      {(view.deadline || view.outcomeCode) && (
        <p className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
          {view.deadline && (
            <span data-testid="deadline" className="font-medium text-navy-900">
              Respond by {ist(view.deadline)} IST
            </span>
          )}
          {view.outcomeCode && <span>Outcome: {humanise(view.outcomeCode)}</span>}
        </p>
      )}
      <Workbench view={view} />
    </>
  );
}
