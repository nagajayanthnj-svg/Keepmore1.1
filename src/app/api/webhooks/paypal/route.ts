import { after } from 'next/server';
import { createPayPalClient, type PayPalClient } from '../../../../paypal/client';
import { verifyWebhookSignature } from '../../../../paypal/webhook-verify';
import { getDb, guard, misconfigured, paypalBaseUrl } from '../../../../lib/server-deps';
import { syncDispute } from '../../../../disputes/sync';
import { handleWebhook } from '../../../../webhooks/receiver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One client for the process, so the access token is reused: the answer has to be quick.
let client: { key: string; paypal: PayPalClient } | undefined;
function paypalClient(id: string, secret: string): PayPalClient {
  const key = `${id}:${secret}:${process.env.PAYPAL_API_BASE ?? ''}`;
  if (client?.key !== key) {
    client = {
      key,
      paypal: createPayPalClient({
        clientId: id,
        clientSecret: secret,
        baseUrl: paypalBaseUrl(process.env.PAYPAL_API_BASE),
      }),
    };
  }
  return client.paypal;
}

export async function POST(req: Request) {
  return guard('paypal webhook', async () => {
    const { PAYPAL_CLIENT_ID: id, PAYPAL_CLIENT_SECRET: secret, PAYPAL_WEBHOOK_ID: webhookId } = process.env;
    if (!id || !secret || !webhookId) return misconfigured();
    const paypal = paypalClient(id, secret);
    return handleWebhook(req, {
      db: getDb(),
      verify: (headers, raw) => verifyWebhookSignature(paypal, webhookId, headers, raw),
      defer: (work) => after(work),
      syncDispute: async (disputeId) => {
        await syncDispute({ db: getDb(), paypal }, disputeId);
      },
    });
  });
}
