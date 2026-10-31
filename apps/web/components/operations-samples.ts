import type { StaffPermission } from '../../../packages/domain/contracts';

export const operationsSampleTabs = new Set([
  'Intakes',
  'Publishing',
  'Fulfillment',
  'Settlements',
  'Support',
  'Reconciliation',
  'Audit',
]);

// Display-only fixtures. These IDs must never be sent to operational endpoints.
export function operationsSamples(permissions: StaffPermission[]) {
  const can = (permission: StaffPermission) => permissions.includes(permission);
  return {
    physical_capture_required: false,
    intakes:
      can('warehouse') || can('via')
        ? [
            {
              id: 'sample-intake-01',
              title: 'Above the Rim · Rookie Edition',
              artwork: 'court',
              owner_name: 'Archive House',
              serial: 'SAMPLE-021/250',
              kind: 'vault',
              status: 'awaiting_receipt',
              evidence:
                'Seller photographs and original purchase receipt supplied. Sealed parcel expected at the receiving desk.',
            },
            {
              id: 'sample-intake-02',
              title: 'LUNA · Midnight Holographic',
              artwork: 'idol',
              owner_name: 'Alex Morgan',
              serial: 'SAMPLE-048/250',
              kind: 'repool',
              status: 'received',
              offered_credits: 500,
              offer_status: 'accepted',
              evidence:
                'Seal and serial matched on receipt. Provisional offer accepted; awaiting condition assessment.',
            },
            {
              id: 'sample-intake-03',
              title: 'Soft Geometry · Cyan',
              artwork: 'orbit2',
              owner_name: 'Archive House',
              serial: 'SAMPLE-112/250',
              kind: 'repool',
              status: 'received',
              offered_credits: 650,
              offer_status: 'pending',
              evidence:
                'Minor corner wear photographed. Revised offer sent to the owner for confirmation.',
            },
            {
              id: 'sample-intake-04',
              title: 'Cloud Runner · First Edition',
              artwork: 'pixel',
              owner_name: 'Alex Morgan',
              serial: 'SAMPLE-007/250',
              kind: 'vault',
              status: 'accepted',
              evidence: 'Identity, condition and custody checks complete. Grade 9 recorded.',
              review_note: 'Accepted into vault · Bin A-14',
            },
          ]
        : [],
    collections: [
      {
        id: 'sample-collection-01',
        title: 'After Hours · Neon Sessions',
        category: 'K-pop',
        description: 'A 150-piece edition of original fictional performers in violet and chrome.',
        rights_evidence:
          'Original character sketches, artist agreement and production proofs attached for review.',
        creator_name: 'Studio Orbit',
        edition_size: 150,
        status: 'submitted',
      },
      {
        id: 'sample-collection-02',
        title: 'Future Forms · Color Studies',
        category: 'Art',
        description: 'Small sculptural worlds exploring translucent color and soft geometry.',
        rights_evidence:
          'Original artwork and production rights reviewed. Awaiting receipt of the first batch.',
        creator_name: 'Studio Orbit',
        edition_size: 100,
        status: 'approved',
      },
    ].filter(
      (collection) =>
        can('rights') || (can('warehouse') && can('via') && collection.status === 'approved'),
    ),
    orders: can('warehouse')
      ? [
          {
            id: 'sample-order-01',
            title: 'LUNA · The Encore',
            status: 'paid',
            fulfillment: 'ship',
            shipping_address: 'Alex Morgan · 12 Sample Lane, Demo City',
            tracking: null,
          },
          {
            id: 'sample-order-02',
            title: 'Courtside · The Finals',
            status: 'fulfilled',
            fulfillment: 'ship',
            shipping_address: 'Jamie Chen · 28 Example Avenue, Demo City',
            tracking: 'DEMO-SHIP-1042',
          },
          {
            id: 'sample-order-03',
            title: 'Orbital No. 04',
            status: 'fulfilled',
            fulfillment: 'vault',
            shipping_address: null,
            tracking: null,
          },
        ]
      : [],
    settlements: can('finance')
      ? [
          {
            id: 'sample-settlement-01',
            title: 'LUNA · The Encore',
            seller_id: 'Archive House',
            amount_cents: 9900,
            status: 'held',
            payment_provider: 'demo',
          },
          {
            id: 'sample-settlement-02',
            title: 'Courtside · The Finals',
            seller_id: 'Archive House',
            amount_cents: 16200,
            status: 'released',
            payment_provider: 'demo',
          },
        ]
      : [],
    cases: can('support')
      ? [
          {
            id: 'sample-case-01',
            user_name: 'Alex Morgan',
            subject: 'Confirm delivery instructions',
            body: 'Please confirm that my parcel will require a signature at delivery.',
            order_id: 'sample-order-01',
            status: 'open',
          },
          {
            id: 'sample-case-02',
            user_name: 'Archive House',
            subject: 'Question about the revised RePool offer',
            body: 'Could you explain how the photographed corner wear affected the provisional offer?',
            status: 'open',
          },
          {
            id: 'sample-case-03',
            user_name: 'Jamie Chen',
            subject: 'Where can I find my certificate?',
            body: 'I would like to view the assessment for my recent collectible.',
            status: 'resolved',
            response:
              'Your certificate is available from the collectible detail page in your collection.',
          },
        ]
      : [],
    balances: can('finance')
      ? [
          { unit: 'USD', account: 'demo_psp_clearing', balance: 11000 },
          { unit: 'USD', account: 'seller_payable', balance: -9900 },
          { unit: 'USD', account: 'platform_revenue', balance: -1100 },
          { unit: 'CREDIT', account: 'repool_expense', balance: 500 },
          { unit: 'CREDIT', account: 'credit_liability', balance: -500 },
        ]
      : [],
    integrity: can('finance') ? { unbalanced: 0, pending_events: 3, pending_orders: 0 } : null,
    audit: can('audit')
      ? [
          {
            id: 'sample-audit-01',
            action: 'intake.accepted',
            actor_name: 'PixUP Operations',
            resource_id: 'sample-intake-04',
            created_at: '2026-10-30T16:20:00Z',
          },
          {
            id: 'sample-audit-02',
            action: 'demo.shipment.dispatched',
            actor_name: 'PixUP Operations',
            resource_id: 'sample-order-02',
            created_at: '2026-10-30T15:45:00Z',
          },
          {
            id: 'sample-audit-03',
            action: 'collection.rights.approved',
            actor_name: 'PixUP Operations',
            resource_id: 'sample-collection-02',
            created_at: '2026-10-29T18:10:00Z',
          },
        ]
      : [],
  };
}
