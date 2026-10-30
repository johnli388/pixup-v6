import { z } from 'zod';
import { one, type Database, type SQL } from '../../../packages/database/index';
import { check, id, audit, provenance, assertNoRefund } from '../../../packages/domain/core';
import { type Actor, requireStaff } from './auth';
import { lockChannels, assertChannelFree } from './channel-core';
import { approvedEvidence } from './evidence';

const note = z.string().trim().min(10).max(2000),
  code = z.string().trim().min(3).max(100);
export const captureInput = z
  .object({
    observed_serial: code,
    seal: code,
    bin: code,
    front_file: z.string(),
    back_file: z.string(),
    note,
  })
  .strict();
export const shipmentInput = z.object({ seal: code, evidence_id: z.string() }).strict();
export const trackingInput = z
  .object({
    client_key: z.string().min(8).max(120),
    expected_sequence: z.number().int().min(0),
    kind: z.enum(['dispatched', 'delivered', 'loss', 'damage', 'returned']),
    seal: code,
    evidence_id: z.string(),
    note,
  })
  .strict();
export const incidentInput = z
  .object({
    asset_id: z.string(),
    order_id: z.string().optional(),
    kind: z.enum(['loss', 'damage', 'identity_mismatch']),
    evidence_id: z.string(),
    note,
  })
  .strict();
export async function noPhysicalIncident(tx: SQL, asset: string) {
  check(
    !(await one(tx, "SELECT id FROM physical_incidents WHERE asset_id=$1 AND state='open'", [
      asset,
    ])),
    'PHYSICAL_HOLD',
    'Resolve the physical loss, damage or identity incident first.',
  );
}
export async function intakeCaptureGate(
  tx: SQL,
  intake: any,
  actor: Actor,
  action: string,
  required: boolean,
) {
  if (!['receive', 'accept'].includes(action)) return;
  await noPhysicalIncident(tx, intake.asset_id);
  check(
    !(await one(
      tx,
      "SELECT id FROM shipments WHERE asset_id=$1 AND state IN ('in_transit','exception')",
      [intake.asset_id],
    )),
    'RETURN_REQUIRED',
    'Record the physical return before receiving the item.',
  );
  const c = await one(tx, 'SELECT * FROM physical_captures WHERE intake_id=$1', [intake.id]);
  check(
    c || !required,
    'CAPTURE_REQUIRED',
    'Capture the item identity, seal, bin and approved front/back evidence before receipt.',
  );
  if (!c) return;
  check(
    c.expected_serial === c.observed_serial,
    'IDENTITY_MISMATCH',
    'The received item identity does not match.',
  );
  await approvedEvidence(tx, c.front_file, intake.asset_id, ['intake']);
  await approvedEvidence(tx, c.back_file, intake.asset_id, ['intake']);
  if (action === 'accept')
    check(
      c.captured_by !== actor.id,
      'SELF_REVIEW',
      'A different VIA reviewer must assess the captured intake.',
      403,
    );
}
async function report(tx: SQL, actor: Actor, d: z.infer<typeof incidentInput>) {
  await approvedEvidence(tx, d.evidence_id, d.asset_id, ['incident', 'shipment', 'intake']);
  const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [d.asset_id]);
  check(a, 'NOT_FOUND', 'Item not found.', 404);
  const iid = id();
  await tx.query(
    'INSERT INTO physical_incidents(id,asset_id,order_id,kind,reporter_id,evidence_id,note) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [iid, d.asset_id, d.order_id || null, d.kind, actor.id, d.evidence_id, d.note],
  );
  await tx.query("UPDATE assets SET custody='quarantine' WHERE id=$1", [d.asset_id]);
  await tx.query("UPDATE certificates SET status='revoked' WHERE asset_id=$1 AND status='active'", [
    d.asset_id,
  ]);
  await tx.query(
    "UPDATE assets SET certification='revoked' WHERE id=$1 AND certification='verified'",
    [d.asset_id],
  );
  await tx.query("UPDATE listings SET status='withdrawn' WHERE asset_id=$1 AND status='active'", [
    d.asset_id,
  ]);
  await tx.query(
    "UPDATE shipments SET state='exception',updated_at=now() WHERE asset_id=$1 AND state<>'returned'",
    [d.asset_id],
  );
  await tx.query(
    'INSERT INTO support_cases(id,user_id,order_id,subject,body) VALUES ($1,$2,$3,$4,$5)',
    [iid, actor.id, d.order_id || null, `Physical ${d.kind} review`, d.note],
  );
  await provenance(
    tx,
    d.asset_id,
    actor.id,
    'physical_exception',
    'Physical custody exception recorded. Authentication and circulation require review.',
  );
  await audit(tx, actor.id, 'physical.incident_reported', iid, {
    asset_id: d.asset_id,
    kind: d.kind,
  });
  return { id: iid };
}
export class LogisticsService {
  constructor(private db: Database) {}
  async dashboard(actor: Actor) {
    requireStaff(actor);
    const warehouse = actor.staff_permissions.includes('warehouse'),
      support = actor.staff_permissions.includes('support'),
      via = actor.staff_permissions.includes('via');
    check(
      warehouse || support || via,
      'FORBIDDEN',
      'Physical operations permission required.',
      403,
    );
    return {
      intakes:
        warehouse || via
          ? (
              await this.db.query(
                "SELECT i.id,i.asset_id,i.status,a.title,a.serial,c.id AS capture_id,c.label_code,c.seal,c.bin FROM intakes i JOIN assets a ON a.id=i.asset_id LEFT JOIN physical_captures c ON c.intake_id=i.id WHERE i.status IN ('awaiting_receipt','received') ORDER BY i.created_at LIMIT 100",
              )
            ).rows
          : [],
      orders: warehouse
        ? (
            await this.db.query(
              "SELECT o.id,o.asset_id,a.title FROM orders o JOIN assets a ON a.id=o.asset_id WHERE o.status='paid' AND o.fulfillment='ship' AND o.channel='web' AND NOT EXISTS(SELECT 1 FROM shipments s WHERE s.order_id=o.id) ORDER BY o.created_at LIMIT 100",
            )
          ).rows
        : [],
      shipments: warehouse
        ? (
            await this.db.query(
              'SELECT s.*,a.title FROM shipments s JOIN assets a ON a.id=s.asset_id ORDER BY s.created_at DESC LIMIT 100',
            )
          ).rows
        : [],
      incidents: (
        await this.db.query(
          'SELECT i.*,a.title FROM physical_incidents i JOIN assets a ON a.id=i.asset_id ORDER BY i.created_at DESC LIMIT 100',
        )
      ).rows,
    };
  }
  async capture(actor: Actor, iid: string, input: z.infer<typeof captureInput>) {
    requireStaff(actor, 'warehouse');
    const d = captureInput.parse(input);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const i = await one(tx, 'SELECT * FROM intakes WHERE id=$1 FOR UPDATE', [iid]);
      check(
        i?.status === 'awaiting_receipt',
        'INVALID_STATE',
        'Capture identity before recording receipt.',
      );
      check(
        i.user_id !== actor.id,
        'SELF_REVIEW',
        'Another warehouse operator must capture your item.',
        403,
      );
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [i.asset_id]);
      check(a && a.owner_id === i.user_id, 'OWNER_CHANGED', 'Item ownership changed.');
      await noPhysicalIncident(tx, a.id);
      await assertNoRefund(tx, a.id);
      await assertChannelFree(tx, a.id);
      check(
        a.serial === d.observed_serial,
        'IDENTITY_MISMATCH',
        'Serial does not match. Report an identity incident; do not receive this item.',
      );
      const old = await one(tx, 'SELECT * FROM physical_captures WHERE intake_id=$1', [iid]);
      if (old) {
        check(
          Object.entries(d).every(([k, v]) => old[k] === v),
          'CAPTURE_CONFLICT',
          'Capture is immutable; report a discrepancy for review.',
        );
        return old;
      }
      check(d.front_file !== d.back_file, 'CAPTURE_VIEWS', 'Use separate front and back evidence.');
      const front = await approvedEvidence(tx, d.front_file, a.id, ['intake']),
        back = await approvedEvidence(tx, d.back_file, a.id, ['intake']);
      check(
        front.mime.startsWith('image/') && back.mime.startsWith('image/'),
        'CAPTURE_VIEWS',
        'Front and back captures must be images.',
      );
      const cid = id(),
        label = `PXI-${id()}`;
      await tx.query(
        'INSERT INTO physical_captures(id,intake_id,asset_id,captured_by,expected_serial,observed_serial,seal,bin,front_file,back_file,note,label_code) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [
          cid,
          iid,
          a.id,
          actor.id,
          a.serial,
          d.observed_serial,
          d.seal,
          d.bin,
          d.front_file,
          d.back_file,
          d.note,
          label,
        ],
      );
      await audit(tx, actor.id, 'physical.identity_captured', cid, {
        intake_id: iid,
        asset_id: a.id,
      });
      return (await one(tx, 'SELECT * FROM physical_captures WHERE id=$1', [cid]))!;
    });
  }
  async createShipment(actor: Actor, oid: string, input: z.infer<typeof shipmentInput>) {
    requireStaff(actor, 'warehouse');
    const d = shipmentInput.parse(input);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [oid]);
      check(
        o?.channel === 'web' && o.fulfillment === 'ship',
        'SHIPMENT_SCOPE',
        'This adapter supports individual web shipment orders.',
      );
      const old = await one(tx, 'SELECT * FROM shipments WHERE order_id=$1', [oid]);
      if (old) {
        check(
          old.seal === d.seal && old.evidence_id === d.evidence_id,
          'LABEL_CONFLICT',
          'Resume the original shipment label.',
        );
        return old;
      }
      await this.dispatchable(tx, o);
      await approvedEvidence(tx, d.evidence_id, o.asset_id, ['shipment']);
      const sid = id();
      await tx.query(
        "INSERT INTO shipments(id,order_id,asset_id,created_by,provider,label_code,seal,evidence_id) VALUES ($1,$2,$3,$4,'simulator',$5,$6,$7)",
        [sid, oid, o.asset_id, actor.id, `DEMO-${id()}`, d.seal, d.evidence_id],
      );
      await audit(tx, actor.id, 'shipment.demo_label_created', sid, { order_id: oid });
      return (await one(tx, 'SELECT * FROM shipments WHERE id=$1', [sid]))!;
    });
  }
  private async dispatchable(tx: SQL, o: any) {
    check(o.status === 'paid', 'INVALID_STATE', 'Order is not awaiting shipment.');
    const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [o.asset_id]);
    check(
      a && a.owner_id === o.buyer_id && a.custody === 'vault',
      'CUSTODY_CHANGED',
      'The buyer must own this item in vault custody.',
    );
    await noPhysicalIncident(tx, o.asset_id);
    await assertNoRefund(tx, o.asset_id);
    await assertChannelFree(tx, o.asset_id);
    check(
      !(await one(
        tx,
        "SELECT id FROM listings WHERE asset_id=$1 AND status IN ('active','reserved') UNION ALL SELECT id FROM intakes WHERE asset_id=$1 AND status IN ('awaiting_receipt','received')",
        [o.asset_id],
      )),
      'ASSET_BUSY',
      'Resolve inventory reservations or intakes before shipping.',
    );
  }
  async event(actor: Actor, sid: string, input: z.infer<typeof trackingInput>) {
    requireStaff(actor, 'warehouse');
    const d = trackingInput.parse(input);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const s = await one(tx, 'SELECT * FROM shipments WHERE id=$1 FOR UPDATE', [sid]);
      check(s, 'NOT_FOUND', 'Shipment not found.', 404);
      check(
        d.seal === s.seal,
        'SEAL_MISMATCH',
        'Scan or enter the seal recorded on this shipment.',
      );
      const old = await one(
        tx,
        'SELECT * FROM shipment_events WHERE shipment_id=$1 AND client_key=$2',
        [sid, d.client_key],
      );
      if (old) {
        check(
          old.kind === d.kind &&
            old.evidence_id === d.evidence_id &&
            old.note === d.note &&
            old.sequence === d.expected_sequence + 1,
          'EVENT_CONFLICT',
          'Event key has different contents.',
        );
        return { ok: true };
      }
      check(
        s.sequence === d.expected_sequence,
        'SHIPMENT_VERSION',
        'Shipment changed; refresh before recording another event.',
      );
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [s.order_id]);
      check(
        o && ['paid', 'fulfilled'].includes(o.status),
        'ORDER_CHANGED',
        'Order is no longer eligible for shipment updates.',
      );
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [s.asset_id]);
      check(
        a && a.owner_id === o.buyer_id,
        'OWNER_CHANGED',
        'Item ownership changed; investigate before recording custody.',
      );
      await approvedEvidence(tx, d.evidence_id, s.asset_id, ['shipment', 'incident']);
      let next: string;
      if (d.kind === 'dispatched') {
        check(
          s.state === 'label_created',
          'SHIPMENT_STATE',
          'Only a prepared label can be dispatched.',
        );
        await this.dispatchable(tx, o);
        next = 'in_transit';
        await tx.query("UPDATE assets SET custody='shipping' WHERE id=$1", [s.asset_id]);
      } else if (d.kind === 'delivered') {
        check(
          s.state === 'in_transit' && a.custody === 'shipping',
          'SHIPMENT_STATE',
          'Delivery requires an uninterrupted in-transit shipment.',
        );
        await noPhysicalIncident(tx, s.asset_id);
        await assertNoRefund(tx, s.asset_id);
        next = 'delivered';
        await tx.query("UPDATE assets SET custody='delivered' WHERE id=$1", [s.asset_id]);
        await tx.query("UPDATE orders SET status='fulfilled',tracking=$2 WHERE id=$1", [
          o.id,
          s.label_code,
        ]);
      } else if (d.kind === 'returned') {
        check(
          ['in_transit', 'exception', 'delivered'].includes(s.state),
          'SHIPMENT_STATE',
          'Return requires dispatched, delivered or exception stock.',
        );
        next = 'returned';
        await tx.query("UPDATE assets SET custody='quarantine' WHERE id=$1", [s.asset_id]);
      } else {
        check(
          ['label_created', 'in_transit', 'delivered'].includes(s.state),
          'SHIPMENT_STATE',
          'Shipment already has an exception or return.',
        );
        next = 'exception';
        await report(tx, actor, {
          asset_id: s.asset_id,
          order_id: o.id,
          kind: d.kind,
          evidence_id: d.evidence_id,
          note: d.note,
        });
      }
      await tx.query(
        'INSERT INTO shipment_events(id,shipment_id,client_key,sequence,kind,evidence_id,actor_id,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id(), sid, d.client_key, s.sequence + 1, d.kind, d.evidence_id, actor.id, d.note],
      );
      await tx.query(
        'UPDATE shipments SET state=$2,sequence=sequence+1,updated_at=now() WHERE id=$1',
        [sid, next],
      );
      if (!['loss', 'damage'].includes(d.kind))
        await provenance(
          tx,
          s.asset_id,
          actor.id,
          `shipment_${d.kind}`,
          `Simulated carrier ${d.kind} recorded with private evidence. No title or money movement.`,
        );
      await audit(tx, actor.id, 'shipment.simulator_event', sid, {
        kind: d.kind,
        sequence: s.sequence + 1,
      });
      return { ok: true };
    });
  }
  async incident(actor: Actor, input: z.infer<typeof incidentInput>) {
    const d = incidentInput.parse(input);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [d.asset_id]);
      check(
        a &&
          (a.owner_id === actor.id ||
            (actor.is_staff &&
              actor.staff_permissions.some((p) => ['warehouse', 'support', 'via'].includes(p)))),
        'NOT_FOUND',
        'Item not found.',
        404,
      );
      if (d.order_id)
        check(
          await one(tx, 'SELECT id FROM orders WHERE id=$1 AND asset_id=$2', [
            d.order_id,
            d.asset_id,
          ]),
          'ORDER_SCOPE',
          'Order does not refer to this item.',
        );
      return report(tx, actor, d);
    });
  }
  async resolve(actor: Actor, iid: string, version: number, note: string) {
    requireStaff(actor, 'support');
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const i = await one(tx, 'SELECT * FROM physical_incidents WHERE id=$1 FOR UPDATE', [iid]);
      check(
        i?.state === 'open' && i.version === version,
        'INCIDENT_VERSION',
        'Incident changed; refresh before resolving.',
      );
      check(
        i.reporter_id !== actor.id,
        'SELF_REVIEW',
        'Another support reviewer must resolve the incident.',
        403,
      );
      await tx.query(
        "UPDATE physical_incidents SET state='resolved',version=version+1,resolution=$2,resolved_by=$3,resolved_at=now() WHERE id=$1",
        [iid, note, actor.id],
      );
      await tx.query("UPDATE support_cases SET status='resolved',response=$2 WHERE id=$1", [
        iid,
        note,
      ]);
      await audit(tx, actor.id, 'physical.incident_resolved', iid, { note });
      return { ok: true }; // Deliberately keeps quarantine and certificate revocation until a fresh intake/VIA assessment.
    });
  }
  async order(actor: Actor, oid: string) {
    check(
      await one(this.db, 'SELECT id FROM orders WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2)', [
        oid,
        actor.id,
      ]),
      'NOT_FOUND',
      'Order not found.',
      404,
    );
    const s = await one(
      this.db,
      'SELECT id,provider,label_code,state,sequence,updated_at FROM shipments WHERE order_id=$1',
      [oid],
    );
    return {
      shipment: s || null,
      events: s
        ? (
            await this.db.query(
              'SELECT sequence,kind,created_at FROM shipment_events WHERE shipment_id=$1 ORDER BY sequence',
              [s.id],
            )
          ).rows
        : [],
    };
  }
}
