import { one, type Database, type SQL } from '../../../packages/database/index';
import { audit, check, id } from '../../../packages/domain/core';
import {
  priceMethodology,
  summarizePrices,
  type PriceInput,
} from '../../../packages/domain/price-methodology';
import { requireStaff, type Actor } from './auth';
import { lockChannels } from './channel-core';
import { canonical } from '../../../packages/domain/trust';
export class PricingService {
  constructor(private db: Database) {}
  async cohort(
    actor: Actor,
    d: { label: string; definition: string; grade: string; asset_ids: string[] },
  ) {
    requireStaff(actor, 'finance');
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const cid = id();
      await tx.query(
        'INSERT INTO price_cohorts(id,label,definition,grade,created_by) VALUES ($1,$2,$3,$4,$5)',
        [cid, d.label, d.definition, d.grade, actor.id],
      );
      for (const aid of d.asset_ids) {
        const a = await one(tx, 'SELECT grade,kind FROM assets WHERE id=$1', [aid]);
        check(
          a?.grade === d.grade && a.kind === 'specimen',
          'COHORT_MISMATCH',
          'Every specimen must match the exact cohort grade.',
        );
        check(
          !(await one(tx, 'SELECT asset_id FROM asset_price_cohorts WHERE asset_id=$1', [aid])),
          'COHORT_ASSIGNED',
          'A specimen already has an immutable cohort assignment.',
        );
        await tx.query(
          'INSERT INTO asset_price_cohorts(asset_id,cohort_id,assigned_by) VALUES ($1,$2,$3)',
          [aid, cid, actor.id],
        );
      }
      await audit(tx, actor.id, 'price.cohort_created', cid, { definition: d.definition });
      return { id: cid };
    });
  }
  async observe(
    actor: Actor,
    d: {
      cohort_id: string;
      source: string;
      source_reference: string;
      permission_evidence: string;
      evidence: string;
      amount_cents: number;
      occurred_at: string;
      final_sale: boolean;
      related_party: boolean;
    },
  ) {
    requireStaff(actor, 'finance');
    check(
      Date.parse(d.occurred_at) <= Date.now(),
      'FUTURE_OBSERVATION',
      'A completed sale cannot be in the future.',
    );
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      check(
        await one(tx, 'SELECT id FROM price_cohorts WHERE id=$1', [d.cohort_id]),
        'NOT_FOUND',
        'Cohort not found.',
        404,
      );
      check(
        d.source !== 'pixup-simulation',
        'SOURCE_RESERVED',
        'The internal source name is reserved.',
      );
      check(
        !(await one(
          tx,
          'SELECT id FROM price_observations WHERE source=$1 AND source_reference=$2',
          [d.source, d.source_reference],
        )),
        'DUPLICATE_OBSERVATION',
        'This source sale is already recorded.',
      );
      const oid = id();
      await tx.query(
        `INSERT INTO price_observations(id,cohort_id,lane,source,source_reference,permission_evidence,evidence,amount_cents,currency,occurred_at,final_sale,related_party,submitted_by)
      VALUES ($1,$2,'external',$3,$4,$5,$6,$7,'USD',$8,$9,$10,$11)`,
        [
          oid,
          d.cohort_id,
          d.source,
          d.source_reference,
          d.permission_evidence,
          d.evidence,
          d.amount_cents,
          d.occurred_at,
          d.final_sale,
          d.related_party,
          actor.id,
        ],
      );
      await audit(tx, actor.id, 'price.observation_submitted', oid);
      return { id: oid };
    });
  }
  async review(actor: Actor, oid: string, decision: string, reason: string) {
    requireStaff(actor, 'finance');
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const o = await one(tx, 'SELECT * FROM price_observations WHERE id=$1', [oid]);
      check(o, 'NOT_FOUND', 'Observation not found.', 404);
      check(
        o.submitted_by !== actor.id,
        'SELF_REVIEW',
        'Another finance reviewer must decide this observation.',
        403,
      );
      check(
        decision === 'include' || decision === 'exclude',
        'INVALID_DECISION',
        'Unknown observation decision.',
        400,
      );
      check(
        decision === 'exclude' || (o.final_sale && !o.related_party),
        'OBSERVATION_INELIGIBLE',
        'Nonfinal or related-party sales cannot be included.',
      );
      await tx.query(
        'INSERT INTO price_observation_reviews(observation_id,decision,reason,reviewer_id) VALUES ($1,$2,$3,$4)',
        [oid, decision, reason, actor.id],
      );
      await audit(tx, actor.id, 'price.observation_reviewed', oid, { decision, reason });
      return { ok: true };
    });
  }
  private async capture(tx: SQL, actor: Actor, cid: string) {
    // Demo and Stripe test transactions always stay in the simulation lane.
    await tx.query(
      `INSERT INTO price_observations(id,cohort_id,lane,order_id,source,source_reference,permission_evidence,evidence,amount_cents,currency,occurred_at,final_sale,related_party,submitted_by)
    SELECT 'order:'||o.id,ap.cohort_id,'simulation',o.id,'pixup-simulation',o.id,'Internal synthetic transaction fixture','Order and journal record',o.total_cents-o.shipping_cents+o.credit_units,'USD',o.paid_at,true,o.buyer_id=o.seller_id,$2
    FROM orders o JOIN asset_price_cohorts ap ON ap.asset_id=o.asset_id WHERE ap.cohort_id=$1 AND o.paid_at IS NOT NULL AND o.total_cents-o.shipping_cents+o.credit_units>0 ON CONFLICT DO NOTHING`,
      [cid, actor.id],
    );
  }
  private async calculate(tx: SQL, cid: string, lane: string, asOf: string) {
    const rows = (
      await tx.query(
        `SELECT p.*,r.decision,o.status AS order_status,o.credit_units,a.grade,a.certification,c.grade AS cohort_grade,
      (EXISTS(SELECT 1 FROM payment_refunds f WHERE f.order_id=o.id AND f.status NOT IN ('failed','canceled')) OR EXISTS(SELECT 1 FROM payment_adjustments r WHERE r.order_id=o.id AND r.state NOT IN ('failed','canceled')) OR EXISTS(SELECT 1 FROM provider_disputes d WHERE d.order_id=o.id)) AS refund,
      EXISTS(SELECT 1 FROM memberships b JOIN memberships s ON s.org_id=b.org_id WHERE b.user_id=o.buyer_id AND s.user_id=o.seller_id) AS affiliated
      FROM price_observations p JOIN price_cohorts c ON c.id=p.cohort_id
      LEFT JOIN LATERAL (SELECT decision FROM price_observation_reviews WHERE observation_id=p.id ORDER BY sequence DESC LIMIT 1) r ON true
      LEFT JOIN orders o ON o.id=p.order_id LEFT JOIN assets a ON a.id=o.asset_id WHERE p.cohort_id=$1 AND p.lane=$2 ORDER BY p.id`,
        [cid, lane],
      )
    ).rows;
    const inputs: PriceInput[] = rows.map((o) => ({
      id: o.id,
      amount_cents: o.amount_cents,
      occurred_at: new Date(o.occurred_at).toISOString(),
      reason: !o.final_sale
        ? 'not_final'
        : o.related_party || o.affiliated
          ? 'related_party'
          : o.decision === 'exclude'
            ? 'excluded'
            : o.order_id
              ? o.refund || o.order_status === 'refunded'
                ? 'refund'
                : !['paid', 'fulfilled'].includes(o.order_status)
                  ? 'not_final'
                  : o.credit_units > 0
                    ? 'credit_consideration'
                    : o.grade !== o.cohort_grade
                      ? 'grade_changed'
                      : o.certification !== 'verified'
                        ? 'eligibility_revoked'
                        : null
              : o.decision !== 'include'
                ? 'not_reviewed'
                : null,
    }));
    return summarizePrices(inputs, asOf);
  }
  async snapshot(actor: Actor, cid: string, lane: string) {
    requireStaff(actor, 'finance');
    check(['simulation', 'external'].includes(lane), 'INVALID_LANE', 'Unknown price lane.', 400);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      check(
        await one(tx, 'SELECT id FROM price_cohorts WHERE id=$1', [cid]),
        'NOT_FOUND',
        'Cohort not found.',
        404,
      );
      if (lane === 'simulation') await this.capture(tx, actor, cid);
      const asOf = new Date().toISOString(),
        computed = await this.calculate(tx, cid, lane, asOf),
        sid = id();
      await tx.query(
        'INSERT INTO price_snapshots(id,cohort_id,lane,methodology,as_of,inputs,result,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          sid,
          cid,
          lane,
          priceMethodology.version,
          asOf,
          JSON.stringify(computed.decisions),
          JSON.stringify(computed.result),
          actor.id,
        ],
      );
      await audit(tx, actor.id, 'price.snapshot_created', sid, { lane, cohort_id: cid });
      return { id: sid, ...computed.result };
    });
  }
  async reference(assetId: string) {
    const c = await one(
      this.db,
      'SELECT c.* FROM price_cohorts c JOIN asset_price_cohorts ap ON ap.cohort_id=c.id WHERE ap.asset_id=$1',
      [assetId],
    );
    if (!c) return { methodology: priceMethodology, state: 'cohort_not_configured', lanes: [] };
    const lanes = [];
    for (const lane of ['simulation', 'external']) {
      const last = await one(
        this.db,
        'SELECT id,as_of,result,inputs FROM price_snapshots WHERE cohort_id=$1 AND lane=$2 ORDER BY created_at DESC,id DESC LIMIT 1',
        [c.id, lane],
      );
      if (!last) {
        lanes.push({ lane, state: 'not_published' });
        continue;
      }
      // Revalidate against current reversals/reviews and recency. Historical snapshots remain immutable.
      const now = await this.calculate(this.db, c.id, lane, new Date().toISOString());
      const changed = canonical(now.decisions) !== canonical(last.inputs);
      const old = Date.now() - new Date(last.as_of).getTime() > 86400000;
      const state = changed ? 'superseded_inputs' : old ? 'refresh_required' : now.result.state;
      const asset = await one(this.db, 'SELECT grade FROM assets WHERE id=$1', [assetId]);
      const valid = state === 'available' && asset?.grade === c.grade;
      lanes.push({
        ...last.result,
        lane,
        snapshot_id: last.id,
        state: asset?.grade !== c.grade ? 'grade_changed' : state,
        median_cents: valid ? last.result.median_cents : null,
        range_cents: valid ? last.result.range_cents : null,
      });
    }
    return {
      methodology: priceMethodology,
      cohort: { id: c.id, label: c.label, definition: c.definition, grade: c.grade },
      lanes,
    };
  }
  async dashboard(actor: Actor) {
    requireStaff(actor, 'finance');
    return {
      methodology: priceMethodology,
      cohorts: (
        await this.db.query('SELECT * FROM price_cohorts ORDER BY created_at DESC LIMIT 100')
      ).rows,
      observations: (
        await this.db.query(
          `SELECT p.*,r.decision FROM price_observations p LEFT JOIN LATERAL (SELECT decision FROM price_observation_reviews WHERE observation_id=p.id ORDER BY sequence DESC LIMIT 1) r ON true ORDER BY p.created_at DESC LIMIT 100`,
        )
      ).rows,
      snapshots: (
        await this.db.query(
          'SELECT id,cohort_id,lane,result,as_of FROM price_snapshots ORDER BY created_at DESC LIMIT 100',
        )
      ).rows,
      governance: {
        state: 'policy_not_configured',
        reserves_enabled: false,
        actions_enabled: false,
        vacv: null,
      },
    };
  }
}
