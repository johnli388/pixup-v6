import type { Database } from '../../../packages/database/index';
import { one } from '../../../packages/database/index';
import { check, id, journal, provenance, audit, notify } from '../../../packages/domain/core';
import { requireStaff, type Actor } from './auth';
import { repoolTerms, type StaffPermission } from '../../../packages/domain/contracts';

export class OperationsService {
  constructor(private db: Database) {}
  async offer(actor: Actor, intakeId: string) {
    const intake = await one(
      this.db,
      "SELECT id,status,offer_version,accepted_offer_version,offer_status,offered_credits,offer_expires_at FROM intakes WHERE id=$1 AND user_id=$2 AND kind='repool'",
      [intakeId, actor.id],
    );
    check(intake, 'NOT_FOUND', 'RePool intake not found.', 404);
    const versions = (
      await this.db.query(
        'SELECT version,credit_units,policy_version,expires_at,note,created_at FROM repool_offer_versions WHERE intake_id=$1 ORDER BY version',
        [intakeId],
      )
    ).rows;
    return { ...intake, terms: repoolTerms, versions };
  }
  async reoffer(
    actor: Actor,
    intakeId: string,
    data: { expected_version: number; credit_units: number; note: string },
  ) {
    requireStaff(actor, 'via');
    return this.db.transaction(async (tx) => {
      const intake = await one(tx, 'SELECT * FROM intakes WHERE id=$1 FOR UPDATE', [intakeId]);
      check(
        intake?.kind === 'repool' && intake.status === 'received',
        'INVALID_STATE',
        'Only received RePool items can be reoffered.',
      );
      check(
        intake.user_id !== actor.id,
        'SELF_REVIEW',
        'A different person must review this intake.',
        403,
      );
      check(
        intake.offer_status !== 'declined',
        'INVALID_STATE',
        'The owner declined; arrange the return.',
      );
      check(
        intake.offer_version === data.expected_version,
        'VERSION_CONFLICT',
        'The offer changed. Reload its latest version.',
      );
      check(
        Number.isInteger(data.credit_units) &&
          data.credit_units > 0 &&
          data.credit_units <= 1000000,
        'INVALID_OFFER',
        'Enter a positive demo credit amount up to 1,000,000.',
        400,
      );
      const offer = await one(
        tx,
        `UPDATE intakes SET offer_version=offer_version+1,offered_credits=$2,
        offer_status='awaiting_consent',offer_expires_at=now()+interval '7 days',review_note=$3 WHERE id=$1 RETURNING *`,
        [intakeId, data.credit_units, data.note],
      );
      await tx.query(
        'INSERT INTO repool_offer_versions(intake_id,version,credit_units,expires_at,note,created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [
          intakeId,
          offer!.offer_version,
          data.credit_units,
          offer!.offer_expires_at,
          data.note,
          actor.id,
        ],
      );
      await audit(tx, actor.id, 'repool.reoffered', intakeId, {
        version: offer!.offer_version,
        credit_units: data.credit_units,
      });
      await notify(
        tx,
        intake.user_id,
        'Review your revised RePool offer',
        'No title or credits transfer until you accept the latest terms and inspection is completed.',
        `${intakeId}:${offer!.offer_version}`,
      );
      return { version: offer!.offer_version };
    });
  }
  async decideOffer(
    actor: Actor,
    intakeId: string,
    data: { expected_version: number; accept: boolean },
  ) {
    return this.db.transaction(async (tx) => {
      const intake = await one(tx, 'SELECT * FROM intakes WHERE id=$1 FOR UPDATE', [intakeId]);
      check(
        intake?.user_id === actor.id && intake.kind === 'repool',
        'NOT_FOUND',
        'RePool intake not found.',
        404,
      );
      check(
        intake.status === 'received',
        'INVALID_STATE',
        'This intake is not awaiting an offer decision.',
      );
      check(
        intake.offer_version === data.expected_version,
        'VERSION_CONFLICT',
        'The offer changed. Reload and review the latest terms.',
      );
      if (
        (data.accept && intake.offer_status === 'accepted') ||
        (!data.accept && intake.offer_status === 'declined')
      )
        return { ok: true };
      check(
        intake.offer_status === 'awaiting_consent',
        'INVALID_STATE',
        'This offer no longer awaits consent.',
      );
      if (data.accept)
        check(
          new Date(intake.offer_expires_at).getTime() > Date.now(),
          'OFFER_EXPIRED',
          'This offer has expired. Contact support for a new offer.',
        );
      await tx.query('UPDATE intakes SET offer_status=$2,accepted_offer_version=$3 WHERE id=$1', [
        intakeId,
        data.accept ? 'accepted' : 'declined',
        data.accept ? data.expected_version : intake.accepted_offer_version,
      ]);
      await audit(
        tx,
        actor.id,
        data.accept ? 'repool.offer_accepted' : 'repool.offer_declined',
        intakeId,
        { version: data.expected_version },
      );
      return { ok: true };
    });
  }
  async intake(actor: Actor, data: any) {
    return this.db.transaction(async (tx) => {
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [data.asset_id]);
      check(a && a.owner_id === actor.id, 'FORBIDDEN', 'You do not own this collectible.', 403);
      check(
        !(await one(
          tx,
          "SELECT id FROM orders WHERE asset_id=$1 AND status='paid' AND fulfillment='ship'",
          [a.id],
        )),
        'SHIPMENT_PENDING',
        'Resolve the outgoing shipment before requesting intake.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM listings WHERE asset_id=$1 AND status IN ('active','reserved')",
          [a.id],
        )),
        'ASSET_BUSY',
        'Withdraw the listing before requesting intake.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM intakes WHERE asset_id=$1 AND status IN ('awaiting_receipt','received')",
          [a.id],
        )),
        'INTAKE_PENDING',
        'An intake is already in progress.',
      );
      check(
        !['shipping', 'delivered', 'quarantine'].includes(a.custody),
        'CUSTODY_INELIGIBLE',
        'Resolve the custody exception before intake.',
      );
      if (data.kind === 'repool')
        check(
          a.certification === 'verified',
          'VIA_REQUIRED',
          'VIA certification is required before a recirculation offer.',
        );
      else
        check(
          a.custody !== 'vault' || a.certification !== 'verified',
          'ALREADY_VAULTED',
          'This item is already certified and vaulted.',
        );
      const intakeId = id();
      check(
        data.accepted_terms === true,
        'TERMS_REQUIRED',
        'Accept the intake terms before submitting.',
        400,
      );
      // Fixed demo offer, explicitly not a market valuation or promised production rate.
      const offered = data.kind === 'repool' ? repoolTerms.initial_credit_units : 0;
      await tx.query(
        'INSERT INTO intakes(id,asset_id,user_id,kind,offered_credits,evidence) VALUES ($1,$2,$3,$4,$5,$6)',
        [intakeId, a.id, actor.id, data.kind, offered, data.evidence],
      );
      if (data.kind === 'repool') {
        await tx.query('UPDATE intakes SET accepted_offer_version=1 WHERE id=$1', [intakeId]);
        await tx.query(
          `INSERT INTO repool_offer_versions(intake_id,version,credit_units,expires_at,note,created_by)
          SELECT id,1,offered_credits,offer_expires_at,'Original provisional demo buyback offer',$2 FROM intakes WHERE id=$1`,
          [intakeId, actor.id],
        );
      }
      if (a.custody !== 'vault')
        await tx.query("UPDATE assets SET custody='intake' WHERE id=$1", [a.id]);
      await provenance(
        tx,
        a.id,
        actor.id,
        'intake_requested',
        data.kind === 'repool'
          ? 'Owner accepted a provisional demo recirculation offer of 500 credits; subject to inspection.'
          : 'Vault intake and authentication requested.',
      );
      await audit(tx, actor.id, 'intake.requested', intakeId);
      return { id: intakeId, offered_credits: offered };
    });
  }
  async dashboard(actor: Actor) {
    requireStaff(actor);
    const can = (permission: StaffPermission) => actor.staff_permissions.includes(permission);
    const canIntakes = can('warehouse') || can('via');
    return {
      permissions: actor.staff_permissions,
      collections: can('rights')
        ? (
            await this.db.query(
              "SELECT c.*,o.name AS creator_name FROM collections c JOIN organizations o ON o.id=c.org_id WHERE status IN ('submitted','approved') ORDER BY c.created_at",
            )
          ).rows
        : can('warehouse') && can('via')
          ? (
              await this.db.query(
                "SELECT c.id,c.title,c.description,c.category,c.edition_size,c.status,o.name AS creator_name FROM collections c JOIN organizations o ON o.id=c.org_id WHERE c.status='approved' ORDER BY c.created_at",
              )
            ).rows
          : [],
      intakes: canIntakes
        ? (
            await this.db.query(
              'SELECT i.*,a.title,a.artwork,a.serial,a.custody,a.grade,u.name AS owner_name FROM intakes i JOIN assets a ON a.id=i.asset_id JOIN users u ON u.id=i.user_id ORDER BY i.created_at DESC',
            )
          ).rows
        : [],
      settlements: can('finance')
        ? (
            await this.db.query(
              'SELECT s.*,a.title,o.status AS order_status FROM settlements s JOIN orders o ON o.id=s.order_id JOIN assets a ON a.id=o.asset_id ORDER BY s.created_at DESC',
            )
          ).rows
        : [],
      orders: can('warehouse')
        ? (
            await this.db.query(
              "SELECT o.id,o.asset_id,o.status,o.fulfillment,o.shipping_address,o.tracking,o.created_at,a.title,a.artwork FROM orders o JOIN assets a ON a.id=o.asset_id WHERE status IN ('paid','fulfilled') ORDER BY o.created_at DESC",
            )
          ).rows
        : [],
      cases: can('support')
        ? (
            await this.db.query(
              'SELECT s.*,u.name AS user_name FROM support_cases s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC',
            )
          ).rows
        : [],
      balances: can('finance')
        ? (
            await this.db.query(
              'SELECT e.unit,l.account,sum(l.amount)::int AS balance FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id GROUP BY e.unit,l.account ORDER BY e.unit,l.account',
            )
          ).rows
        : [],
      integrity: can('finance')
        ? await one(
            this.db,
            `SELECT
        (SELECT count(*)::int FROM (SELECT e.id FROM journal_entries e LEFT JOIN journal_lines l ON l.entry_id=e.id GROUP BY e.id HAVING COALESCE(sum(l.amount),0)<>0 OR count(l.id)<2) broken) AS unbalanced,
        (SELECT count(*)::int FROM outbox WHERE processed_at IS NULL) AS pending_events,
        (SELECT count(*)::int FROM orders WHERE status='pending_payment') AS pending_orders`,
          )
        : null,
      audit: can('audit')
        ? (
            await this.db.query(
              'SELECT a.*,u.name AS actor_name FROM audit_log a JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 50',
            )
          ).rows
        : [],
    };
  }
  async reviewCollection(actor: Actor, cid: string, data: any) {
    requireStaff(actor, 'rights');
    return this.db.transaction(async (tx) => {
      const c = await one(tx, 'SELECT * FROM collections WHERE id=$1 FOR UPDATE', [cid]);
      check(c, 'NOT_FOUND', 'Collection not found.', 404);
      check(c.status === 'submitted', 'INVALID_STATE', 'This collection is not awaiting review.');
      check(
        !(await one(tx, 'SELECT user_id FROM memberships WHERE org_id=$1 AND user_id=$2', [
          c.org_id,
          actor.id,
        ])),
        'SELF_REVIEW',
        'A publisher cannot review their own collection.',
        403,
      );
      await tx.query('UPDATE collections SET status=$2,review_note=$3 WHERE id=$1', [
        cid,
        data.approve ? 'approved' : 'changes_requested',
        data.note,
      ]);
      await audit(tx, actor.id, 'collection.reviewed', cid, {
        approve: data.approve,
        note: data.note,
      });
      return { ok: true };
    });
  }
  async receiveStock(actor: Actor, cid: string, data: any) {
    requireStaff(actor, 'warehouse');
    requireStaff(actor, 'via');
    return this.db.transaction(async (tx) => {
      const c = await one(tx, 'SELECT * FROM collections WHERE id=$1 FOR UPDATE', [cid]);
      check(
        c?.status === 'approved',
        'INVALID_STATE',
        'Rights approval is required before receiving production stock.',
      );
      check(
        !(await one(tx, 'SELECT user_id FROM memberships WHERE org_id=$1 AND user_id=$2', [
          c.org_id,
          actor.id,
        ])),
        'SELF_REVIEW',
        'Production assessment requires an independent reviewer.',
        403,
      );
      const count = await one(
        tx,
        'SELECT count(*)::int AS count FROM assets WHERE collection_id=$1',
        [cid],
      );
      check(
        count!.count + data.quantity <= c.edition_size,
        'EDITION_LIMIT',
        'Stock exceeds the approved edition size.',
      );
      const publisher = await one(
        tx,
        "SELECT user_id FROM memberships WHERE org_id=$1 AND role='owner' ORDER BY user_id LIMIT 1",
        [c.org_id],
      );
      check(publisher, 'PUBLISHER_REQUIRED', 'Publisher account is missing.');
      for (let i = 0; i < data.quantity; i++) {
        const aid = id(),
          assessment = id(),
          number = count!.count + i + 1;
        await tx.query(
          "INSERT INTO assets(id,collection_id,owner_id,title,category,serial,artwork,description,grade,certification,custody,edition_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'10','verified','vault',$9)",
          [
            aid,
            cid,
            publisher.user_id,
            `${c.title} · #${String(number).padStart(3, '0')}`,
            c.category,
            `PX-${id().slice(0, 12).toUpperCase()}`,
            c.artwork,
            c.description,
            number,
          ],
        );
        await tx.query(
          "INSERT INTO assessments(id,asset_id,reviewer_id,result,grade,evidence) VALUES ($1,$2,$3,'verified','10',$4)",
          [assessment, aid, actor.id, data.evidence],
        );
        await tx.query('INSERT INTO certificates(id,asset_id,assessment_id) VALUES ($1,$2,$3)', [
          `VIA-${id().slice(0, 12).toUpperCase()}`,
          aid,
          assessment,
        ]);
        await provenance(
          tx,
          aid,
          actor.id,
          'production_received',
          'Demo production stock received and assessed. Assessment evidence retained privately.',
        );
      }
      await tx.query("UPDATE collections SET status='stock_ready' WHERE id=$1", [cid]);
      await audit(tx, actor.id, 'collection.stock_received', cid, { quantity: data.quantity });
      return { ok: true };
    });
  }
  async intakeAction(actor: Actor, intakeId: string, data: any) {
    requireStaff(actor, ['receive', 'return'].includes(data.action) ? 'warehouse' : 'via');
    return this.db.transaction(async (tx) => {
      const intake = await one(tx, 'SELECT * FROM intakes WHERE id=$1 FOR UPDATE', [intakeId]);
      check(intake, 'NOT_FOUND', 'Intake not found.', 404);
      check(
        intake.user_id !== actor.id,
        'SELF_REVIEW',
        'Review must be performed by a different person.',
        403,
      );
      const asset = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [intake.asset_id]);
      check(
        asset && asset.owner_id === intake.user_id,
        'OWNER_CHANGED',
        'Ownership changed. Escalate this intake.',
      );
      if (data.action === 'return') {
        requireStaff(actor, 'warehouse');
        check(
          intake.kind === 'repool' &&
            intake.status === 'received' &&
            intake.offer_status === 'declined',
          'INVALID_STATE',
          'Only a declined RePool offer can use this return action.',
        );
        await tx.query("UPDATE intakes SET status='rejected',review_note=$2 WHERE id=$1", [
          intakeId,
          data.note,
        ]);
        await tx.query(
          "UPDATE assets SET custody='seller',certification='unverified' WHERE id=$1",
          [asset.id],
        );
        await tx.query(
          "UPDATE certificates SET status='superseded' WHERE asset_id=$1 AND status='active'",
          [asset.id],
        );
        await provenance(
          tx,
          asset.id,
          actor.id,
          'repool_returned',
          'Demo return to owner after declined offer. No title transfer or credits; new custody review required.',
        );
      } else if (data.action === 'receive') {
        check(
          intake.status === 'awaiting_receipt',
          'INVALID_STATE',
          'This intake has already been received.',
        );
        await tx.query("UPDATE intakes SET status='received',review_note=$2 WHERE id=$1", [
          intakeId,
          data.note,
        ]);
        await tx.query("UPDATE assets SET custody='intake' WHERE id=$1", [asset.id]);
        await provenance(
          tx,
          asset.id,
          actor.id,
          'intake_received',
          'Physical receipt recorded for inspection.',
        );
      } else {
        check(
          intake.status === 'received',
          'RECEIPT_REQUIRED',
          'Receive the item before recording an inspection decision.',
        );
        if (data.action === 'reject') {
          await tx.query("UPDATE intakes SET status='rejected',review_note=$2 WHERE id=$1", [
            intakeId,
            data.note,
          ]);
          await tx.query(
            "UPDATE assets SET custody='quarantine',certification='rejected' WHERE id=$1",
            [asset.id],
          );
          await tx.query(
            "UPDATE certificates SET status='revoked' WHERE asset_id=$1 AND status='active'",
            [asset.id],
          );
          await provenance(
            tx,
            asset.id,
            actor.id,
            'intake_rejected',
            'Inspection rejected; item quarantined and active certification revoked.',
          );
        } else {
          check(data.action === 'accept', 'INVALID_ACTION', 'Unknown intake action.', 400);
          if (intake.kind === 'repool') {
            check(
              intake.offer_status === 'accepted' &&
                intake.accepted_offer_version === intake.offer_version,
              'OFFER_CONSENT_REQUIRED',
              'The owner must accept the current offer before credits or title can transfer.',
            );
            check(
              new Date(intake.offer_expires_at).getTime() > Date.now(),
              'OFFER_EXPIRED',
              'Issue a new offer and obtain consent before admission.',
            );
            check(
              asset.certification === 'verified',
              'CERTIFICATE_INELIGIBLE',
              'Resolve the revoked or rejected VIA assessment before admission.',
            );
          }
          const assessment = id();
          await tx.query(
            "INSERT INTO assessments(id,asset_id,reviewer_id,result,grade,evidence) VALUES ($1,$2,$3,'verified',$4,$5)",
            [assessment, asset.id, actor.id, data.grade, data.note],
          );
          await tx.query(
            "UPDATE certificates SET status='superseded' WHERE asset_id=$1 AND status='active'",
            [asset.id],
          );
          await tx.query('INSERT INTO certificates(id,asset_id,assessment_id) VALUES ($1,$2,$3)', [
            `VIA-${id().slice(0, 12).toUpperCase()}`,
            asset.id,
            assessment,
          ]);
          await tx.query(
            "UPDATE assets SET custody='vault',certification='verified',grade=$2 WHERE id=$1",
            [asset.id, data.grade],
          );
          await tx.query("UPDATE intakes SET status='accepted',review_note=$2 WHERE id=$1", [
            intakeId,
            data.note,
          ]);
          if (intake.kind === 'repool') {
            await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [intake.user_id]);
            await tx.query(
              "UPDATE assets SET owner_id='platform',platform_owned=true WHERE id=$1",
              [asset.id],
            );
            await tx.query(
              'INSERT INTO credit_lots(id,user_id,intake_id,issued,available,origin) VALUES ($1,$2,$3,$4,$4,$5)',
              [id(), intake.user_id, intake.id, intake.offered_credits, `RePool · ${asset.title}`],
            );
            await journal(tx, `repool:${intake.id}`, 'CREDIT', 'Accepted demo RePool buyback', [
              ['credit_issuance', intake.offered_credits],
              [`credits:${intake.user_id}`, -intake.offered_credits],
            ]);
            await provenance(
              tx,
              asset.id,
              actor.id,
              'repool_admitted',
              `Accepted into RePool. Title transferred to PixUP; ${intake.offered_credits} demo credits granted under offer v${intake.offer_version}.`,
            );
          } else
            await provenance(
              tx,
              asset.id,
              actor.id,
              'vault_accepted',
              'VIA review passed. Accepted into vault custody; ownership retained.',
            );
          await notify(
            tx,
            intake.user_id,
            'Your intake is complete',
            intake.kind === 'repool'
              ? `${intake.offered_credits} demo credits are now available.`
              : 'Your collectible is ready to list.',
            intakeId,
          );
        }
      }
      await audit(tx, actor.id, `intake.${data.action}`, intakeId, { note: data.note });
      return { ok: true };
    });
  }
  async revoke(actor: Actor, assetId: string, note: string) {
    requireStaff(actor, 'via');
    return this.db.transaction(async (tx) => {
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [assetId]);
      check(a, 'NOT_FOUND', 'Asset not found.', 404);
      check(
        !(await one(tx, "SELECT id FROM listings WHERE asset_id=$1 AND status='reserved'", [
          assetId,
        ])),
        'PAYMENT_PENDING',
        'Resolve pending checkout before revocation.',
      );
      await tx.query(
        "UPDATE certificates SET status='revoked' WHERE asset_id=$1 AND status='active'",
        [assetId],
      );
      await tx.query("UPDATE assets SET certification='revoked',custody='quarantine' WHERE id=$1", [
        assetId,
      ]);
      await tx.query(
        "UPDATE listings SET status='withdrawn' WHERE asset_id=$1 AND status='active'",
        [assetId],
      );
      await tx.query(
        "INSERT INTO assessments(id,asset_id,reviewer_id,result,grade,evidence) VALUES ($1,$2,$3,'revoked',$4,$5)",
        [id(), assetId, actor.id, a.grade, note],
      );
      await provenance(
        tx,
        assetId,
        actor.id,
        'certificate_revoked',
        'VIA certification revoked. Contact support for review.',
      );
      await audit(tx, actor.id, 'certificate.revoked', assetId, { note });
      return { ok: true };
    });
  }
  async releaseSettlement(actor: Actor, sid: string) {
    requireStaff(actor, 'finance');
    return this.db.transaction(async (tx) => {
      const reference = await one(tx, 'SELECT order_id FROM settlements WHERE id=$1', [sid]);
      check(reference, 'NOT_FOUND', 'Settlement not found.', 404);
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [reference.order_id]);
      const s = await one(tx, 'SELECT * FROM settlements WHERE id=$1 FOR UPDATE', [sid]);
      check(
        o?.payment_provider === 'demo',
        'STRIPE_PAYOUT_NOT_ENABLED',
        'Stripe test seller payouts require a separate Connect integration; simulated release is disabled.',
      );
      check(s?.status === 'held', 'INVALID_STATE', 'This settlement is not held.');
      check(
        o?.status === 'fulfilled',
        'FULFILLMENT_REQUIRED',
        'Complete fulfillment before releasing the settlement.',
      );
      check(
        !(await one(tx, "SELECT id FROM support_cases WHERE order_id=$1 AND status='open'", [
          o.id,
        ])),
        'DISPUTE_OPEN',
        'Resolve open support cases before settlement.',
      );
      await journal(tx, `payout:${sid}`, 'USD', 'Simulated seller payout', [
        [`seller_payable:${s.seller_id}`, s.amount_cents],
        ['demo_psp_clearing', -s.amount_cents],
      ]);
      await tx.query("UPDATE settlements SET status='released' WHERE id=$1", [sid]);
      await audit(tx, actor.id, 'demo.settlement.released', sid);
      return { ok: true };
    });
  }
  async fulfill(actor: Actor, oid: string, tracking: string) {
    requireStaff(actor, 'warehouse');
    return this.db.transaction(async (tx) => {
      const o = await one(tx, 'SELECT * FROM orders WHERE id=$1 FOR UPDATE', [oid]);
      check(
        o?.status === 'paid' && o.fulfillment === 'ship',
        'INVALID_STATE',
        'Order is not awaiting shipment.',
      );
      const a = await one(tx, 'SELECT * FROM assets WHERE id=$1 FOR UPDATE', [o.asset_id]);
      check(
        a && a.owner_id === o.buyer_id && a.custody === 'vault',
        'CUSTODY_CHANGED',
        'Cannot ship an item no longer owned by this buyer or held in vault.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM listings WHERE asset_id=$1 AND status IN ('active','reserved')",
          [a.id],
        )),
        'ASSET_BUSY',
        'Item has an active listing.',
      );
      check(
        !(await one(
          tx,
          "SELECT id FROM intakes WHERE asset_id=$1 AND status IN ('awaiting_receipt','received')",
          [a.id],
        )),
        'ASSET_BUSY',
        'An intake is in progress.',
      );
      await tx.query("UPDATE orders SET status='fulfilled',tracking=$2 WHERE id=$1", [
        oid,
        tracking,
      ]);
      await tx.query("UPDATE assets SET custody='shipping' WHERE id=$1", [a.id]);
      await provenance(
        tx,
        a.id,
        actor.id,
        'shipment_dispatched',
        'Demo shipment dispatched. Custody continuity now depends on delivery evidence.',
      );
      await audit(tx, actor.id, 'demo.shipment.dispatched', oid, { tracking });
      return { ok: true };
    });
  }
  async support(actor: Actor, data: any) {
    return this.db.transaction(async (tx) => {
      if (data.order_id)
        check(
          await one(
            tx,
            'SELECT id FROM orders WHERE id=$1 AND (buyer_id=$2 OR seller_id=$2) FOR UPDATE',
            [data.order_id, actor.id],
          ),
          'NOT_FOUND',
          'Order not found.',
          404,
        );
      const cid = id();
      await tx.query(
        'INSERT INTO support_cases(id,user_id,order_id,subject,body) VALUES ($1,$2,$3,$4,$5)',
        [cid, actor.id, data.order_id || null, data.subject, data.body],
      );
      return { id: cid };
    });
  }
  async resolveCase(actor: Actor, cid: string, response: string) {
    requireStaff(actor, 'support');
    return this.db.transaction(async (tx) => {
      check(
        await one(tx, 'SELECT id FROM support_cases WHERE id=$1 FOR UPDATE', [cid]),
        'NOT_FOUND',
        'Case not found.',
        404,
      );
      await tx.query("UPDATE support_cases SET status='resolved',response=$2 WHERE id=$1", [
        cid,
        response,
      ]);
      await audit(tx, actor.id, 'support.resolved', cid);
      return { ok: true };
    });
  }
  async worker() {
    await this.db.transaction(async (tx) => {
      const events = (
        await tx.query(
          'SELECT * FROM outbox WHERE processed_at IS NULL ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED',
        )
      ).rows;
      for (const e of events) {
        if (e.type === 'notification')
          await tx.query(
            'INSERT INTO activity(id,user_id,title,body) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
            [e.id, e.payload.user, e.payload.title, e.payload.body],
          );
        await tx.query('UPDATE outbox SET processed_at=now() WHERE id=$1', [e.id]);
      }
    });
  }
  async activity(actor: Actor) {
    return (
      await this.db.query(
        'SELECT * FROM activity WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',
        [actor.id],
      )
    ).rows;
  }
  async cases(actor: Actor) {
    return (
      await this.db.query('SELECT * FROM support_cases WHERE user_id=$1 ORDER BY created_at DESC', [
        actor.id,
      ])
    ).rows;
  }
}
