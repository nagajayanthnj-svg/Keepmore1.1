// Browser requests to our write and analyse routes must come from our own pages (T-503, done early for T-401).
// A request without an Origin header (curl, server-side) is allowed: browsers always send one on a POST.

export function rejectCrossOrigin(req: Request): Response | null {
  const deny = () => Response.json({ error: 'CROSS_ORIGIN' }, { status: 403 });
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return deny();
  const origin = req.headers.get('origin');
  if (!origin) return null;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return deny();
  }
  const own = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  return own && host === own ? null : deny();
}
