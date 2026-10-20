import { z } from 'zod';

/** What the browser may send: SKUs and quantities. Prices, totals and currency are never read from it. */
export const cartSchema = z.object({
  items: z
    .array(z.object({ sku: z.string().regex(/^[A-Za-z0-9]+$/), qty: z.int().min(1).max(10) }))
    .min(1)
    .max(8),
});
export type Cart = z.infer<typeof cartSchema>;

export const PAYPAL_ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;
