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
        <h1 className="text-2xl font-semibold tracking-tight">Dispute not found</h1>
        <p className="mt-2 text-neutral-700">
          No dispute with that id is stored here. <Link className="text-sky-800 underline" href="/disputes">Back to the inbox</Link>.
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Dispute {view.disputeId}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" data-testid="case-header">
        <span>{humanise(view.reason)}</span>
        <span aria-hidden>·</span>
        <span data-testid="stage">{view.stage}</span>
        <span aria-hidden>·</span>
        <span data-testid="status">{humanise(view.status)}</span>
        <span aria-hidden>·</span>
        <strong>
          {fromMinor(view.amountMinor, view.currency)} {view.currency}
        </strong>
        <TruthStateBadge state={view.truthState} />
        <StaleBadge state={view.stale ? 'Stale' : 'Fresh'} />
        {view.deadline && <span data-testid="deadline">Respond by {ist(view.deadline)} IST</span>}
        {view.outcomeCode && <span>Outcome: {humanise(view.outcomeCode)}</span>}
      </div>
      <Workbench view={view} />
    </>
  );
}
