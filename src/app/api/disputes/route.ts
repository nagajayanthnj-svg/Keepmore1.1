import { loadInbox } from '../../../disputes/inbox';
import { getDb, guard } from '../../../lib/server-deps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Inbox data from our database. It reads no PayPal data. */
export async function GET() {
  return guard('list disputes', async () => {
    const inbox = await loadInbox(getDb(), new Date());
    return inbox.ready ? Response.json({ rows: inbox.rows }) : Response.json({ error: 'NOT_READY' }, { status: 503 });
  });
}
