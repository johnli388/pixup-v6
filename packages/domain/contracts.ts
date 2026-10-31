import { z } from 'zod';

export const itemPassportSchema = z.object({
  asset_id: z.string(),
  serial: z.string(),
  registered_at: z.string(),
  issuance_mode: z.enum(['agency', 'licensed', 'platform', 'own']).nullable(),
  registration_scope: z.literal(
    'Registry entry only; not proof of rights or physical authenticity.',
  ),
  authenticity: z.enum(['unverified', 'verified', 'rejected', 'revoked']),
  condition_grade: z.string(),
  assessed_at: z.string().nullable(),
  certificate: z
    .object({ id: z.string(), status: z.enum(['active', 'superseded', 'revoked']) })
    .nullable(),
  custody: z.string(),
  simulation: z.literal(true),
});
export type ItemPassport = z.infer<typeof itemPassportSchema>;

export const paymentConfigurationSchema = z.object({
  provider: z.enum(['demo', 'stripe_test']),
  test_mode: z.literal(true),
  payment_methods: z.array(z.string()),
  webhooks_configured: z.boolean(),
});
export type PaymentConfiguration = z.infer<typeof paymentConfigurationSchema>;
export const refundStatusSchema = z.object({
  id: z.string(),
  status: z.enum([
    'created',
    'pending',
    'requires_action',
    'succeeded',
    'failed',
    'canceled',
    'requires_review',
  ]),
  amount_cents: z.number().int().nonnegative(),
});
export type RefundStatus = z.infer<typeof refundStatusSchema>;
export const paymentStatusSchema = z.object({
  id: z.string(),
  status: z.enum(['pending_payment', 'paid', 'fulfilled', 'refunded', 'canceled']),
  payment_status: z.enum(['created', 'open', 'succeeded', 'canceled', 'requires_review']),
  provider_payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']).nullable(),
  reservation_expires_at: z.string(),
  url: z.string().nullable(),
  refund: refundStatusSchema.nullable(),
});
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;
export const paymentQueueSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.string(),
      total_cents: z.number().int(),
      credit_units: z.number().int(),
      payment_status: z.string(),
      provider_session_id: z.string().nullable(),
      created_at: z.string(),
      review_reason: z.string().nullable(),
      review_status: z.string().nullable(),
      assigned_to: z.string().nullable(),
      version: z.number().int().nullable(),
      due_at: z.string().nullable(),
      refund_id: z.string().nullable(),
      refund_status: z.string().nullable(),
      refund_cents: z.number().int().nullable(),
      adjusted_cash_cents: z.number().int().nonnegative().default(0),
      provider_refund_id: z.string().nullable(),
    }),
  ),
  next_cursor: z.string().nullable(),
});
export type PaymentQueue = z.infer<typeof paymentQueueSchema>;

export const staffPermissions = [
  'rights',
  'warehouse',
  'via',
  'finance',
  'support',
  'audit',
  'identity_admin',
  'community_moderation',
] as const;
export type StaffPermission = (typeof staffPermissions)[number];
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  field_errors: z.array(z.object({ field: z.string(), message: z.string() })),
  retryable: z.boolean(),
  correlation_id: z.string(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['personal', 'creator', 'merchant', 'platform']),
  plan: z.string(),
  role: z.enum(['owner', 'publisher', 'operator', 'viewer']),
});
export type Organization = z.infer<typeof organizationSchema>;
export const invitationSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  role: z.enum(['viewer', 'publisher']),
  expires_at: z.string(),
  organization_name: z.string(),
});
export type Invitation = z.infer<typeof invitationSchema>;
export const organizationMembersSchema = z.object({
  members: z.array(
    z.object({
      user_id: z.string(),
      role: organizationSchema.shape.role,
      name: z.string(),
      email: z.string(),
    }),
  ),
  invitations: z.array(
    z.object({
      id: z.string(),
      email: z.string(),
      role: z.enum(['viewer', 'publisher']),
      status: z.enum(['pending', 'accepted', 'revoked']),
      expires_at: z.string(),
    }),
  ),
});
export type OrganizationMembers = z.infer<typeof organizationMembersSchema>;
export const repoolTerms = {
  policy_version: 'demo-repool-v1',
  unit: 'CREDIT',
  initial_credit_units: 500,
  title_effect: 'Ownership transfers to PixUP only after final inspection acceptance.',
  redemption_scope: 'PixUP-owned inventory only. No transfer or cash-out.',
  inspection_conditions:
    'Physical receipt and independent VIA inspection are required. Changed offers need new consent.',
  validity_days: 7,
} as const;
export const repoolTermsSchema = z.object({
  policy_version: z.string(),
  unit: z.literal('CREDIT'),
  initial_credit_units: z.number().int().positive(),
  title_effect: z.string(),
  redemption_scope: z.string(),
  inspection_conditions: z.string(),
  validity_days: z.number().int().positive(),
});
export type RePoolTerms = z.infer<typeof repoolTermsSchema>;
export const repoolOfferSchema = z.object({
  id: z.string(),
  status: z.enum(['awaiting_receipt', 'received', 'accepted', 'rejected']),
  offer_version: z.number().int().positive(),
  accepted_offer_version: z.number().int().nullable(),
  offer_status: z.enum(['accepted', 'awaiting_consent', 'declined']),
  offered_credits: z.number().int(),
  offer_expires_at: z.string(),
  terms: repoolTermsSchema,
  versions: z.array(
    z.object({
      version: z.number().int(),
      credit_units: z.number().int(),
      policy_version: z.string(),
      expires_at: z.string(),
      note: z.string(),
      created_at: z.string(),
    }),
  ),
});
export type RePoolOffer = z.infer<typeof repoolOfferSchema>;
