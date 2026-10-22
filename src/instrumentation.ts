// Starts the dispute poller (T-205) in the Node server when PayPal credentials are set, after warming the PayPal token.
// SYNC_INTERVAL_SECONDS sets the interval (default 900). Set DISABLE_POLLER=1 to turn it off.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.DISABLE_POLLER === '1') return;
  const { getSharedPayPal, getSyncDeps } = await import('./lib/server-deps');
  const deps = getSyncDeps();
  if (!deps) return;
  // The first webhook after a start would otherwise spend its time limit fetching a token (seen live, F-58).
  await getSharedPayPal()
    ?.warmUp()
    .catch(() => console.error('paypal token warm-up failed; the first webhook may need a retry'));
  const { pollIntervalSeconds, pollOnce, startPoller } = await import('./disputes/poller');
  startPoller(
    async () => {
      const r = await pollOnce(deps);
      if (r.errors.length > 0)
        console.error(`dispute poll: ${r.errors.map((e) => `${e.disputeId} ${e.error}`).join(', ')}`);
    },
    pollIntervalSeconds(process.env.SYNC_INTERVAL_SECONDS) * 1000,
  );
}
