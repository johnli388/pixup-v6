import { z } from 'zod';
import type { CheckoutProvider, SessionPayload } from './stripe';
const cents = z.number().int().nonnegative();
export const providerRefundSnapshot = z.object({
  id: z.string().startsWith('re_'),
  amount: cents,
  currency: z.string(),
  payment_intent: z.string(),
  status: z.string(),
  metadata: z.record(z.string(), z.string()).default({}),
});
export const paymentSnapshot = z.object({
  id: z.string().startsWith('pi_'),
  livemode: z.literal(false),
  status: z.literal('succeeded'),
  amount_received: cents,
  currency: z.string(),
  metadata: z.object({ order_id: z.string() }),
  latest_charge: z.object({
    id: z.string().startsWith('ch_'),
    paid: z.literal(true),
    disputed: z.boolean(),
    amount: cents,
    amount_refunded: cents,
    currency: z.string(),
    balance_transaction: z
      .object({
        id: z.string(),
        amount: z.number().int(),
        fee: z.number().int(),
        net: z.number().int(),
        currency: z.string(),
        status: z.enum(['pending', 'available']),
      })
      .nullable(),
  }),
});
export const disputeSnapshot = z.object({
  id: z.string().startsWith('du_'),
  livemode: z.literal(false),
  payment_intent: z.string().startsWith('pi_'),
  amount: cents,
  currency: z.string(),
  status: z.string(),
  evidence_details: z.object({ due_by: z.number().nullable() }),
});
export const recipientSnapshot = z.object({
  id: z.string().startsWith('acct_'),
  type: z.literal('express'),
  country: z.string(),
  metadata: z.record(z.string(), z.string()),
  details_submitted: z.boolean(),
  payouts_enabled: z.boolean(),
  capabilities: z.object({ transfers: z.string().optional() }),
  requirements: z.object({ currently_due: z.array(z.string()) }),
});
export const transferSnapshot = z.object({
  id: z.string().startsWith('tr_'),
  livemode: z.literal(false),
  amount: cents,
  currency: z.string(),
  destination: z.string(),
  source_transaction: z.string().nullable(),
  amount_reversed: cents,
  reversed: z.boolean(),
  metadata: z.record(z.string(), z.string()),
});
export type PaymentSnapshot = z.infer<typeof paymentSnapshot> & {
  refunds: z.infer<typeof providerRefundSnapshot>[];
};
export interface PaymentOperationsProvider extends CheckoutProvider {
  identity(): Promise<string>;
  payment(id: string): Promise<PaymentSnapshot>;
  dispute(id: string): Promise<z.infer<typeof disputeSnapshot>>;
  createRecipient(payload: SessionPayload, key: string): Promise<z.infer<typeof recipientSnapshot>>;
  recipient(id: string): Promise<z.infer<typeof recipientSnapshot>>;
  accountLink(account: string, origin: string): Promise<{ url: string; expires_at: number }>;
  createTransfer(payload: SessionPayload, key: string): Promise<z.infer<typeof transferSnapshot>>;
  transfer(id: string): Promise<z.infer<typeof transferSnapshot>>;
}
