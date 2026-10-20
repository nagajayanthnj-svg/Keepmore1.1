import { createPayPalClient } from '../../../../../paypal/client';
import { getDb, guard, paypalBaseUrl } from '../../../../../lib/server-deps';
import { handleShip } from '../../../../../shipments/ship';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard('ship order', async () => {
    const { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret } = process.env;
    // Without credentials the shipment is still saved locally.
    const paypal =
      clientId && clientSecret
        ? createPayPalClient({ clientId, clientSecret, baseUrl: paypalBaseUrl(process.env.PAYPAL_API_BASE) })
        : null;
    return handleShip(req, (await ctx.params).id, { db: getDb(), paypal });
  });
}
