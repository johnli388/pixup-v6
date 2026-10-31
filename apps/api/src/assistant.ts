import type { Database } from '../../../packages/database/index';
import { one } from '../../../packages/database/index';
import { check, id } from '../../../packages/domain/core';
import { collectionPublishedSql } from '../../../packages/domain/catalog-visibility';
import {
  assistantInput,
  assistantPlan,
  assistantResponse,
  type AssistantInput,
  type AssistantPlan,
  type AssistantResult,
} from '../../../packages/domain/assistant';
import { requireUser, type Actor } from './auth';
import type { AssistantProvider } from './assistant-provider';

const help = [
  {
    title: 'Find and buy cards',
    href: '/marketplace',
    terms: 'buy purchase find search marketplace card collectible checkout payment',
    description:
      'Browse Marketplace, open a collectible, then review checkout. Availability and the final quote are checked again before purchase. This is a demo/test-payment pilot.',
  },
  {
    title: 'Sell a collectible',
    href: '/workspace/seller',
    terms: 'sell seller list listing vault intake',
    description:
      'In Seller studio, add your collectible and request vault intake. Operations records receipt and VIA inspection before an accepted item can be listed.',
  },
  {
    title: 'Find buyers of your sales',
    href: '/account/orders',
    terms: 'buyer buyers customer customers sales orders sold',
    description:
      'Buyer references are available only on your own sales records. Search a buyer reference, card title or order ID. PixUP has no public buyer directory.',
  },
  {
    title: 'Orders, delivery and refunds',
    href: '/account/orders',
    terms: 'order orders shipping delivery tracking refund payment purchase',
    description:
      'Open Orders to review your purchases and sales. Refund eligibility depends on order state and payment provider; Stripe test refunds require Operations payment review.',
  },
  {
    title: 'RePool and credits',
    href: '/account/credits',
    terms: 'repool recirculate credit credits wallet',
    description:
      'Request RePool from Seller studio and explicitly accept the provisional offer. Credits are granted only after receipt and accepted inspection. Credits are usable on eligible PixUP-owned inventory and cannot be withdrawn or transferred.',
  },
  {
    title: 'Certificates and VIA',
    href: '/account/collection',
    terms: 'via certificate certification authenticity grade verification verify',
    description:
      'Open a collectible to view its certificate and recorded provenance. VIA assessment is separate from a sealed-pack opening; community posts do not certify ownership or authenticity.',
  },
  {
    title: 'Publish a collection',
    href: '/workspace/creator',
    terms: 'creator publish collection rights edition studio',
    description:
      'Creator studio supports drafts and rights submissions. Independent rights review and physical stock intake precede publication. Creator access is invitation-only.',
  },
  {
    title: 'Community Hub',
    href: '/community',
    terms: 'community topic topics stories story discussion post guide member',
    description:
      'Community members choose a display name and accept the guidelines before contributing. Posts enter moderation. The pilot may be closed or paused; fictional samples are labeled separately.',
  },
  {
    title: 'Explore local channels',
    href: '/channels',
    terms:
      'channel channels cvm liveup goup waxup local pilot angeles francisco santa monica soma vending',
    description:
      'Channels offers collectible vending, hosted openings, group orders and business cases. California pilot previews are fictional concepts, not confirmed venues or operating schedules. Only activated channels with inventory support checkout.',
  },
  {
    title: 'Account settings and privacy',
    href: '/account/settings',
    terms: 'account settings privacy profile password subscription billing security',
    description:
      'Use Settings to manage account preferences, privacy requests and subscription details. Account security manages authentication. Never share passwords, recovery codes or payment details in chat.',
  },
  {
    title: 'Contact support',
    href: '/account/support',
    terms: 'support contact help dispute problem issue',
    description:
      'Use Help & support for account or order issues. The assistant can find information but cannot resolve disputes or make account changes.',
  },
];
const facts = help.map(({ title, description }) => `${title}: ${description}`).join('\n');
const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
const filler = new Set(
  'a an the me my i we our you please can could would will want like show find search for of from in on to by with and or any some all available card cards collectible collectibles seller sellers buyer buyers customer customers order orders sale sales sold purchase purchased purchases who bought has have do does is are under below less than up dollar dollars usd affordable cheap cheaper cheapest more those these ones only about reference references id number instead'.split(
    ' ',
  ),
);

export function localAssistantPlan(input: AssistantInput): AssistantPlan {
  const message = input.message.toLowerCase();
  const previous = [...input.history].reverse().find((item) => item.role === 'user')?.content || '';
  const context =
    /\b(those|these|cheaper|instead|only|under|below)\b/.test(message) &&
    !/\b(cards?|sellers?|buyers?|orders?)\b/.test(message)
      ? `${previous.toLowerCase()} ${message}`
      : message;
  const intent = /\b(buyers?|customers?|who (bought|purchased))\b/.test(context)
    ? 'buyers'
    : /\b(orders?|my purchases|my sales)\b/.test(context) && !/\bhow\b/.test(context)
      ? 'orders'
      : /^(how|what is|what are|where|why|help)\b/.test(message) ||
          /\b(channels?|community|credits?|repool|via|refund|support|privacy)\b/.test(message)
        ? 'help'
        : /\bsellers?\b/.test(context)
          ? 'sellers'
          : 'cards';
  const categoryFor = (value: string) =>
    /\b(k[ -]?pop|photocards?)\b/i.test(value)
      ? 'K-pop'
      : /\b(sports?|basketball)\b/i.test(value)
        ? 'Sports'
        : /\b(gaming|games?|pixel)\b/i.test(value)
          ? 'Gaming'
          : /\b(art|artwork)\b/i.test(value)
            ? 'Art'
            : null;
  const category = categoryFor(message) || categoryFor(context);
  const prices = [
    ...context.matchAll(/(?:under|below|less than|up to)\s*\$?\s*(\d+(?:\.\d{1,2})?)/gi),
  ];
  const amount = prices.at(-1)?.[1];
  const cleaned = context
    .replace(/(?:under|below|less than|up to)\s*\$?\s*\d+(?:\.\d{1,2})?/gi, '')
    .replace(/\b(k[ -]?pop|photocards?|sports?|basketball|gaming|games?|art|artwork)\b/gi, '');
  return {
    intent,
    query:
      intent === 'help'
        ? input.message.slice(0, 200)
        : normalize(cleaned)
            .split(' ')
            .filter((word) => !filler.has(word))
            .join(' ')
            .slice(0, 200),
    category,
    max_price_cents: amount ? Math.min(10000000, Math.round(Number(amount) * 100)) : null,
  };
}

export class AssistantService {
  constructor(
    private db: Database,
    private provider?: AssistantProvider,
  ) {}

  config() {
    return { ai_available: !!this.provider };
  }

  async reply(actor: Actor | null, input: unknown) {
    const user = requireUser(actor);
    check(!user.mfa_required, 'MFA_REQUIRED', 'Complete account authentication first.', 403);
    const data = assistantInput.parse(input);
    const active = await one(
      this.db,
      'SELECT u.closed_at,p.restriction FROM users u LEFT JOIN privacy_profiles p ON p.user_id=u.id WHERE u.id=$1',
      [user.id],
    );
    check(
      active && !active.closed_at && !active.restriction,
      'ACCOUNT_RESTRICTED',
      'Assistant access is unavailable for this account.',
      403,
    );
    const lease = id();
    // One atomic claim across API instances; never hold a transaction during model calls.
    // A crashed process releases its slot after 60 seconds (provider calls total <=24s).
    const claimed = await one(
      this.db,
      `INSERT INTO assistant_request_limits(user_id,request_count,lease_id,lease_until)
       VALUES ($1,1,$2,now()+interval '60 seconds')
       ON CONFLICT (user_id) DO UPDATE SET
         window_started=CASE WHEN assistant_request_limits.window_started<=now()-interval '60 seconds' THEN now() ELSE assistant_request_limits.window_started END,
         request_count=CASE WHEN assistant_request_limits.window_started<=now()-interval '60 seconds' THEN 1 ELSE assistant_request_limits.request_count+1 END,
         lease_id=EXCLUDED.lease_id,lease_until=EXCLUDED.lease_until
       WHERE (assistant_request_limits.lease_until IS NULL OR assistant_request_limits.lease_until<=now())
         AND (assistant_request_limits.request_count<12 OR assistant_request_limits.window_started<=now()-interval '60 seconds')
       RETURNING user_id`,
      [user.id, lease],
    );
    check(
      claimed,
      'ASSISTANT_RATE_LIMIT',
      'Please wait before sending another assistant message.',
      429,
    );
    try {
      const localPlan = localAssistantPlan(data);
      let plan = localPlan;
      let notice = '';
      let ai = !!this.provider && data.use_ai;
      // Private order/buyer searches never send database results or conversation to AI.
      if (['buyers', 'orders'].includes(localPlan.intent)) ai = false;
      if (ai) {
        try {
          plan = assistantPlan.parse(await this.provider!.plan(data));
        } catch {
          ai = false;
          notice = 'AI is temporarily unavailable. Showing local search and help.';
        }
      }
      if (['buyers', 'orders'].includes(plan.intent)) ai = false;
      const results = await this.search(user, plan);
      let answer = this.localAnswer(plan, results);
      await this.assertLease(user.id, lease);
      if (ai) {
        try {
          answer = await this.provider!.answer(data, results, facts);
        } catch {
          ai = false;
          notice = 'AI is temporarily unavailable. Showing local search and help.';
        }
      }
      if (['buyers', 'orders'].includes(plan.intent))
        notice =
          'Only your own transaction records are searched. These results are not sent to AI.';
      else if (data.use_ai && !this.provider)
        notice = 'AI is not configured. Local search and help are available.';
      await this.assertLease(user.id, lease);
      return assistantResponse.parse({ answer, mode: ai ? 'ai' : 'local', notice, results });
    } finally {
      // A delayed request cannot release a newer process's lease.
      await this.db.query(
        'UPDATE assistant_request_limits SET lease_id=NULL,lease_until=NULL WHERE user_id=$1 AND lease_id=$2',
        [user.id, lease],
      );
    }
  }

  private async assertLease(userId: string, lease: string) {
    check(
      await one(
        this.db,
        'SELECT user_id FROM assistant_request_limits WHERE user_id=$1 AND lease_id=$2 AND lease_until>now()',
        [userId, lease],
      ),
      'ASSISTANT_EXPIRED',
      'This search took too long. Please try again.',
      503,
    );
  }

  private async search(actor: Actor, plan: AssistantPlan): Promise<AssistantResult[]> {
    if (plan.intent === 'help') {
      const terms = normalize(plan.query)
        .split(' ')
        .filter((word) => !filler.has(word));
      const ranked = help
        .map((item) => ({
          item,
          score: terms.reduce(
            (score, word) => score + (item.terms.split(' ').includes(word) ? 1 : 0),
            0,
          ),
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return (ranked.length ? ranked.map(({ item }) => item) : [help[0], help[10]]).map(
        ({ title, description, href }) => ({ kind: 'help', title, description, href }),
      );
    }
    const params: unknown[] = [];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const tokens = normalize(plan.query).split(' ').filter(Boolean).slice(0, 10);
    // Parameterized literal substring matching, including punctuation in order IDs.
    const match = (expression: string) =>
      tokens.map((word) => `strpos(lower(${expression}), ${bind(word)})>0`);
    if (plan.intent === 'buyers' || plan.intent === 'orders') {
      const where = [
        plan.intent === 'buyers'
          ? `o.seller_id=${bind(actor.id)}`
          : `(o.buyer_id=${bind(actor.id)} OR o.seller_id=$1)`,
      ];
      where.push(...match("concat_ws(' ',o.id,o.buyer_id,a.title,o.status)"));
      if (plan.category) where.push(`a.category=${bind(plan.category)}`);
      if (plan.max_price_cents !== null) where.push(`o.total_cents<=${bind(plan.max_price_cents)}`);
      const rows = (
        await this.db.query(
          `SELECT o.id,o.buyer_id,o.status,o.total_cents,a.title FROM orders o JOIN assets a ON a.id=o.asset_id WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC,o.id LIMIT 12`,
          params,
        )
      ).rows;
      return rows.map((row) => ({
        kind: plan.intent === 'buyers' ? 'buyer' : 'order',
        title: plan.intent === 'buyers' ? `Buyer ${row.buyer_id}` : row.title,
        description: `${row.title} · ${row.status.replaceAll('_', ' ')} · Order ${row.id}`,
        href: `/account/orders/${encodeURIComponent(row.id)}`,
        price_cents: row.total_cents,
      }));
    }
    const where = [
      "a.kind='specimen'",
      "l.status='active'",
      'u.closed_at IS NULL',
      collectionPublishedSql,
      "NOT EXISTS(SELECT 1 FROM channel_allocations ca WHERE ca.asset_id=a.id AND ca.state<>'closed')",
    ];
    where.push(...match("concat_ws(' ',a.title,a.description,a.category,c.title,u.name)"));
    if (plan.category) where.push(`a.category=${bind(plan.category)}`);
    if (plan.max_price_cents !== null) where.push(`l.price_cents<=${bind(plan.max_price_cents)}`);
    const rows = (
      await this.db.query(
        `SELECT a.id,a.title,a.category,a.artwork,l.price_cents,u.name AS seller_name,c.title AS collection_title FROM assets a JOIN listings l ON l.asset_id=a.id JOIN users u ON u.id=l.seller_id LEFT JOIN collections c ON c.id=a.collection_id WHERE ${where.join(' AND ')} ORDER BY l.price_cents,a.id LIMIT 12`,
        params,
      )
    ).rows;
    return rows.map((row) => ({
      kind: plan.intent === 'sellers' ? 'seller' : 'card',
      title: plan.intent === 'sellers' ? row.seller_name : row.title,
      description:
        plan.intent === 'sellers'
          ? `${row.title} · ${row.category}`
          : `${row.category} · ${row.seller_name}${row.collection_title ? ` · ${row.collection_title}` : ''}`,
      href: `/items/${encodeURIComponent(row.id)}`,
      price_cents: row.price_cents,
      artwork: row.artwork,
    }));
  }

  private localAnswer(plan: AssistantPlan, results: AssistantResult[]) {
    if (plan.intent === 'help') return results.map((item) => item.description).join('\n\n');
    if (plan.intent === 'buyers')
      return results.length
        ? 'Here are buyer references from your own sales. Open an order to review the transaction. There is no public buyer directory.'
        : 'No buyers matched your sales records. Try a card title or buyer reference, or search “my orders” for your purchases. Other members’ buyers are private.';
    if (!results.length)
      return 'No matches found. Try a card title, category or seller name, or broaden your price limit.';
    if (plan.intent === 'orders')
      return 'Here are matching orders where you are the buyer or seller. Open an order for its current status.';
    return plan.intent === 'sellers'
      ? 'Here are matching public seller listings. Open a card to see its seller and current availability.'
      : 'Here are matching cards, ordered by price. Open a card to review its details; price and availability are checked again at checkout.';
  }
}
