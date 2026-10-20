// Starts the dispute poller (T-205) in the Node server when PayPal credentials are set.
// SYNC_INTERVAL_SECONDS sets the interval (default 900). Set DISABLE_POLLER=1 to turn it off.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.DISABLE_POLLER === '1') return;
  const { getSyncDeps } = await import('./lib/server-deps');
  const deps = getSyncDeps();
  if (!deps) return;
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
