// Poller and stale detection (T-205). Webhooks are only a nudge (Phase 0 saw none for the link change
// or the hold release), so polling is required. It only reads from PayPal and never writes to it.
import { DISPUTE_ID, DisputeParseError } from './parse';
import { syncDispute, type SyncDeps } from './sync';

export const STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_SECONDS = 900;
const LIST_PAGE_SIZE = 50;

/** Stale from 5 minutes after the last sync. A sync time in the future (clock skew) is not stale. */
export function isStale(lastSyncedAt: Date, now: Date): boolean {
  return now.getTime() - lastSyncedAt.getTime() >= STALE_AFTER_MS;
}

/** SYNC_INTERVAL_SECONDS: a whole number from 30 to 86400, else the default of 900. */
export function pollIntervalSeconds(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return DEFAULT_INTERVAL_SECONDS;
  const n = Number(value);
  return n >= 30 && n <= 86_400 ? n : DEFAULT_INTERVAL_SECONDS;
}

export interface PollError {
  /** A dispute id, or "(list)" when the list call failed. */
  disputeId: string;
  /** A short code or error name. Never a PayPal body or message: those can hold buyer data. */
  error: string;
}

export interface PollResult {
  /** Listed by PayPal and not stored before. */
  discovered: number;
  /** Disputes synced without an error. */
  synced: number;
  errors: PollError[];
}

const errorCode = (e: unknown): string =>
  e instanceof DisputeParseError ? 'UNUSABLE_DISPUTE' : e instanceof Error ? e.name : 'ERROR';

/**
 * Lists PayPal's disputes and syncs the ones we do not hold, then refreshes every stored case that is
 * not resolved. One failure is recorded and the rest carry on. Only the first page of the list is read,
 * so more than LIST_PAGE_SIZE new disputes in one interval would be picked up over several runs.
 * UNVERIFIED: the list response shape (only items[].dispute_id is read); no real list is on file.
 */
export async function pollOnce(deps: SyncDeps): Promise<PollResult> {
  const errors: PollError[] = [];
  const known = new Set(
    (await deps.db.disputeCase.findMany({ select: { paypalDisputeId: true } })).map((c) => c.paypalDisputeId),
  );

  const listed = new Set<string>();
  try {
    const res = await deps.paypal.get<unknown>(`/v1/customer/disputes?page_size=${LIST_PAGE_SIZE}`);
    const items = (res.body as { items?: unknown } | null)?.items;
    if (!Array.isArray(items)) throw new DisputeParseError('List is not usable: items');
    for (const item of items) {
      const id = (item as { dispute_id?: unknown } | null)?.dispute_id;
      if (typeof id === 'string' && DISPUTE_ID.test(id)) listed.add(id);
    }
  } catch (e) {
    errors.push({ disputeId: '(list)', error: errorCode(e) });
  }

  const open = await deps.db.disputeCase.findMany({
    where: { NOT: { status: 'RESOLVED' } },
    select: { paypalDisputeId: true },
  });
  const discovered = [...listed].filter((id) => !known.has(id));
  const targets = [...new Set([...discovered, ...open.map((c) => c.paypalDisputeId)])];

  let synced = 0;
  for (const id of targets) {
    try {
      await syncDispute(deps, id);
      synced += 1;
    } catch (e) {
      errors.push({ disputeId: id, error: errorCode(e) });
    }
  }
  return { discovered: discovered.length, synced, errors };
}

/** Runs `run` every `intervalMs`, never two at once, and never throws. Returns a stop function. */
export function startPoller(
  run: () => Promise<unknown>,
  intervalMs: number,
  onError: (e: unknown) => void = console.error,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void run()
      .catch(onError)
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
