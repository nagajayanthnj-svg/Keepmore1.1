import { after } from 'next/server';
import { verifyWebhookSignature } from '../../../../paypal/webhook-verify';
import { getDb, getSharedPayPal, guard, misconfigured } from '../../../../lib/server-deps';
import { syncDispute } from '../../../../disputes/sync';
import { handleWebhook } from '../../../../webhooks/receiver';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return guard('paypal webhook', async () => {
    const paypal = getSharedPayPal();
    const webhookId = process.env.PAYPAL_WEBHOOK_ID;
    if (!paypal || !webhookId) return misconfigured();
    return handleWebhook(req, {
      db: getDb(),
      verify: (headers, raw) => verifyWebhookSignature(paypal, webhookId, headers, raw),
      defer: (work) => after(work),
      syncDispute: async (disputeId) => {
        await syncDispute({ db: getDb(), paypal, hmacSecret: process.env.HMAC_SECRET }, disputeId);
      },
    });
  });
}
