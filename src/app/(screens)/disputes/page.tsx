import { DataGrid } from '../../../components/data-grid';
import { loadInbox } from '../../../disputes/inbox';
import { INBOX_COLUMNS, inboxGridRows } from '../../../disputes/inbox-grid';
import { getDb } from '../../../lib/server-deps';

export const metadata = { title: 'Disputes · KeepMore' };
export const dynamic = 'force-dynamic';

export default async function InboxPage() {
  const now = new Date();
  const inbox = await loadInbox(getDb(), now);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Disputes</h1>
      <p className="mt-2 text-neutral-700">
        Earliest response deadline first, then open cases with no deadline, then resolved ones. A case is stale when we
        last read it from PayPal five or more minutes ago.
      </p>
      <section aria-labelledby="inbox" className="mt-6">
        <h2 id="inbox" className="sr-only">
          Dispute inbox
        </h2>
        {!inbox.ready ? (
          <p role="status" className="rounded border border-neutral-300 p-3 text-sm">
            The database is not set up yet. Run <code>npm run db:migrate</code> and then <code>npm run db:seed</code>.
          </p>
        ) : inbox.rows.length === 0 ? (
          <p role="status" className="rounded border border-neutral-300 p-3 text-sm">
            No disputes yet. They appear here after PayPal sends one or after a sync.
          </p>
        ) : (
          <DataGrid
            testId="inbox-grid"
            fit="content"
            label="Dispute inbox"
            columns={INBOX_COLUMNS}
            rows={inboxGridRows(inbox.rows, now)}
          />
        )}
      </section>
    </>
  );
}
