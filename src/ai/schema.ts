// Output of the analysis (T-303): one schema shared by the pipeline, the validator and the tests.
// Every claim has a type, so the validator can compare it with the field of the record it cites.
// A claim that has no type is UNTYPED and can never be SUPPORTED.
import { z } from 'zod';

export const ACTION_VALUES = [
  'ACCEPT_CLAIM',
  'PROVIDE_EVIDENCE',
  'PROVIDE_SUPPORTING_INFO',
  'SEND_MESSAGE',
  'ESCALATE',
  'WAIT',
  'NO_ACTION',
] as const;
export type Action = (typeof ACTION_VALUES)[number];

const recordIds = z.array(z.string().regex(/^REC-[A-Z0-9]+$/)).max(10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const minor = z.number().int().nonnegative();
const currency = z.string().regex(/^[A-Z]{3}$/);
const common = { id: z.string().min(1).max(40), recordIds };

export const ClaimSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('ORDER_AMOUNT'), minor, currency }),
  z.object({ ...common, type: z.literal('ORDER_COUNTRY'), country: z.string().regex(/^[A-Z]{2}$/) }),
  z.object({ ...common, type: z.literal('CAPTURE_AMOUNT'), minor, currency }),
  z.object({ ...common, type: z.literal('SELLER_PROTECTION'), value: z.string().min(1).max(40) }),
  z.object({ ...common, type: z.literal('SHIPPED'), carrier: z.string().min(1).max(40), trackingNo: z.string().min(1).max(40), date }),
  z.object({ ...common, type: z.literal('TRACKING_STATUS'), status: z.string().min(1).max(40), date }),
  z.object({ ...common, type: z.literal('DELIVERED'), date }),
  z.object({ ...common, type: z.literal('DELIVERED_TO_NEIGHBOUR'), date }),
  z.object({ ...common, type: z.literal('BUYER_SAID'), quote: z.string().min(1).max(300) }),
  z.object({ ...common, type: z.literal('UNTYPED'), text: z.string().min(1).max(500) }),
]);
export type Claim = z.infer<typeof ClaimSchema>;

export const AnalysisSchema = z
  .object({
    recommendedAction: z.enum(ACTION_VALUES),
    approvalRequired: z.boolean(),
    urgent: z.boolean(),
    summary: z.string().max(1000),
    claims: z.array(ClaimSchema).max(30),
    /** The message draft. It may rest only on the claims it lists. */
    draft: z.object({ text: z.string().min(1).max(3000), claimIds: z.array(z.string()).max(30) }).nullable(),
  })
  .superRefine((o, ctx) => {
    const ids = o.claims.map((c) => c.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'duplicate claim id' });
    for (const id of o.draft?.claimIds ?? [])
      if (!ids.includes(id)) ctx.addIssue({ code: 'custom', message: `draft cites unknown claim ${id}` });
  });
export type Analysis = z.infer<typeof AnalysisSchema>;
