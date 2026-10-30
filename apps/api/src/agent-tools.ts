import { requireEligibility } from '../../../packages/domain/privacy';
import { collectionPublishedSql } from '../../../packages/domain/catalog-visibility';
import { assetPaymentHoldSql } from '../../../packages/domain/inventory-holds';
import { randomBytes } from 'node:crypto';
import { one, type Database } from '../../../packages/database/index';
import { check, id, audit } from '../../../packages/domain/core';
import { hash } from '../../../packages/domain/security';
import { keyInput, toolInput, toolResult } from '../../../packages/domain/channels';
import type { Actor } from './auth';
import { channelMembership } from './channels';
import { gate, lockChannels } from './channel-core';
import { consumeUsage } from '../../../packages/domain/saas';

// Deliberately typed, read-only tools. User text is search data, never executable
// instructions; no model, browser, shell, wallet or mutation tool is available.
export class AgentToolService {
  constructor(private db: Database) {}
  async keys(actor: Actor) {
    return (
      await this.db.query(
        `SELECT k.id,k.name,k.org_id,k.scopes,k.daily_limit,k.expires_at,k.revoked_at,
      (SELECT count(*)::int FROM tool_calls c WHERE c.key_id=k.id AND c.created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS used_today
      FROM tool_keys k JOIN memberships m ON m.org_id=k.org_id AND m.user_id=$1
      WHERE m.role IN ('owner','operator','publisher') ORDER BY k.created_at DESC`,
        [actor.id],
      )
    ).rows;
  }
  async create(actor: Actor, input: unknown) {
    const d = keyInput.parse(input);
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await requireEligibility(tx, actor.id);
      await gate(tx, 'ai');
      await channelMembership(tx, actor, d.org_id);
      const kid = id(),
        secret = `px_tool_${randomBytes(32).toString('hex')}`;
      await tx.query(
        "INSERT INTO tool_keys(id,org_id,created_by,name,secret_hash,scopes,daily_limit,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '30 days')",
        [
          kid,
          d.org_id,
          actor.id,
          d.name,
          hash(secret),
          JSON.stringify([...new Set(d.scopes)]),
          d.daily_limit,
        ],
      );
      await audit(tx, actor.id, 'tool.key_created', kid, { scopes: d.scopes });
      return { id: kid, secret };
    });
  }
  async revoke(actor: Actor, kid: string) {
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      const k = await one(tx, 'SELECT * FROM tool_keys WHERE id=$1', [kid]);
      check(k, 'NOT_FOUND', 'Credential not found.', 404);
      await channelMembership(tx, actor, k.org_id);
      await tx.query('UPDATE tool_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1', [
        kid,
      ]);
      await audit(tx, actor.id, 'tool.key_revoked', kid);
      return { ok: true };
    });
  }
  async execute(authorization: string, operation: string, input: unknown) {
    check(
      ['query', 'match', 'route'].includes(operation),
      'TOOL_UNAVAILABLE',
      'Only query, match and route are available.',
      404,
    );
    const d = toolInput.parse(input);
    check(
      operation !== 'route' || d.asset_id,
      'ASSET_REQUIRED',
      'Route requires an asset identifier.',
      400,
    );
    check(
      /^Bearer px_tool_[a-f0-9]{64}$/.test(authorization),
      'TOOL_AUTH',
      'Provide a scoped tool bearer credential.',
      401,
    );
    return this.db.transaction(async (tx) => {
      await lockChannels(tx);
      await gate(tx, 'ai');
      const k = await one(tx, 'SELECT * FROM tool_keys WHERE secret_hash=$1', [
        hash(authorization.slice(7)),
      ]);
      check(
        k && !k.revoked_at && new Date(k.expires_at).getTime() > Date.now(),
        'TOOL_AUTH',
        'Credential is expired, revoked or invalid.',
        401,
      );
      await channelMembership(tx, { id: k.created_by }, k.org_id);
      await requireEligibility(tx, k.created_by);
      check(
        k.scopes.includes(operation),
        'TOOL_SCOPE',
        'Credential does not authorize this tool.',
        403,
      );
      const digest = hash(JSON.stringify({ operation, ...d }));
      const prior = await one(tx, 'SELECT * FROM tool_calls WHERE key_id=$1 AND request_id=$2', [
        k.id,
        d.request_id,
      ]);
      if (prior) {
        check(
          prior.request_hash === digest,
          'REQUEST_CONFLICT',
          'Request identifier already has different input.',
        );
        return { ...prior.response, replayed: true };
      }
      const used = (await one(
        tx,
        "SELECT count(*)::int AS n FROM tool_calls WHERE key_id=$1 AND created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",
        [k.id],
      ))!.n;
      check(used < k.daily_limit, 'TOOL_QUOTA', 'Daily tool quota exhausted.', 429);
      await consumeUsage(tx, k.org_id, 'tool_calls', `${k.id}:${d.request_id}`);
      const query = d.query.replace(/[\\%_]/g, '\\$&');
      const items = (
        await tx.query(
          `SELECT a.id,a.title,a.category,a.kind,a.certification,a.custody,l.price_cents,
        COALESCE(c.kind,'web') AS channel,c.id AS context_id,ca.id AS allocation_id
        FROM assets a JOIN listings l ON l.asset_id=a.id AND l.status='active'
        LEFT JOIN channel_allocations ca ON ca.asset_id=a.id AND ca.state<>'closed'
        LEFT JOIN channel_contexts c ON c.id=ca.context_id LEFT JOIN channel_gates g ON g.kind=c.kind
        LEFT JOIN channel_devices dv ON dv.context_id=c.id
        WHERE ${collectionPublishedSql} AND l.seller_id<>$1 AND NOT EXISTS(SELECT 1 FROM privacy_profiles pp WHERE pp.user_id=l.seller_id AND pp.restriction IS NOT NULL)
        AND (a.certification='verified' OR (ca.id IS NOT NULL AND a.kind='sealed_pack' AND EXISTS(SELECT 1 FROM sealed_packs p WHERE p.asset_id=a.id AND p.status='sealed')))
        AND (a.custody='vault' OR (c.kind='cvm' AND a.custody='device'))
        AND ((ca.id IS NULL AND a.kind='specimen') OR (ca.state='assigned' AND g.enabled AND (c.deadline IS NULL OR c.deadline>now()) AND
          ((c.kind<>'goup' AND c.status='open') OR (c.kind='goup' AND c.status='locked' AND EXISTS(SELECT 1 FROM group_pledges p WHERE p.allocation_id=ca.id AND p.user_id=$1)))
          AND (c.kind<>'cvm' OR (NOT dv.revoked AND dv.last_seen_at>now()-interval '90 seconds'))
          AND (c.kind<>'waxup' OR EXISTS(SELECT 1 FROM channel_businesses b JOIN memberships m ON m.org_id=b.org_id AND m.user_id=b.user_id WHERE b.user_id=$1 AND m.role IN ('owner','operator','publisher')))))
        AND NOT ${assetPaymentHoldSql('a.id')}
        AND ($2::text IS NULL OR a.category=$2) AND ($3::int IS NULL OR l.price_cents<=$3)
        AND ($4::text IS NULL OR a.id=$4) AND a.title ILIKE $5
        ORDER BY l.price_cents,a.id LIMIT $6`,
          [
            k.created_by,
            d.category || null,
            d.max_price_cents || null,
            d.asset_id || null,
            `%${query}%`,
            d.limit,
          ],
        )
      ).rows;
      const now = new Date();
      const response = toolResult.parse({
        operation,
        request_id: d.request_id,
        as_of: now.toISOString(),
        valid_until: new Date(now.getTime() + 30000).toISOString(),
        replayed: false,
        usage: { used_today: used + 1, daily_limit: k.daily_limit },
        notice:
          'Read-only inventory snapshot. Prices, eligibility and availability are rechecked at checkout. No purchase, reservation or credit grant was performed.',
        items: items.map((item) => ({
          ...item,
          ...(operation === 'match'
            ? {
                match_reason:
                  'Matches the supplied title, category and price filters; ordered by listing price.',
              }
            : {}),
          ...(operation === 'route'
            ? {
                path: item.context_id ? `/channels/${item.context_id}` : `/checkout/${item.id}`,
                requires_user_confirmation: true,
              }
            : {}),
        })),
      });
      await tx.query(
        'INSERT INTO tool_calls(key_id,request_id,request_hash,operation,response) VALUES ($1,$2,$3,$4,$5)',
        [k.id, d.request_id, digest, operation, JSON.stringify(response)],
      );
      return response;
    });
  }
}
