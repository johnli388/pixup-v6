import { CommunityService } from './community';
import * as community from '../../../packages/domain/community';
import { staffPermissions } from '../../../packages/domain/contracts';
import { withDatabaseActor } from '../../../packages/database/context';
import { IdentityService } from './identity';
import { AccessAdministration } from './access-administration';
import { ManagedSignIn } from './managed-identity';
import type { IdentityOptions } from './identity-providers';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Database } from '../../../packages/database/index';
import { DomainError, id } from '../../../packages/domain/core';
import { AuthService, requireUser, type Actor } from './auth';
import { CatalogService } from './catalog';
import { CommerceService } from './commerce';
import { OperationsService } from './operations';
import { MediaService } from './media';
import { EvidenceService, fileInput } from './evidence';
import { type EvidenceOptions } from './evidence-providers';
import {
  LogisticsService,
  captureInput,
  shipmentInput,
  trackingInput,
  incidentInput,
} from './logistics';
import { PaymentService, type PaymentOptions } from './payments';
import { PaymentControls, partialInput } from './payment-controls';
import { ConnectService } from './connect';
import { OrganizationService } from './organizations';
import { ChannelService } from './channels';
import { PrivacyService } from './privacy';
import { MonitoringService } from './monitoring';
import { privacyPolicy } from '../../../packages/domain/privacy';
import { PricingService } from './pricing';
import { TrustService } from './trust';
import { BillingService } from './billing';
import { type BillingOptions } from './billing-provider';
import { FinanceService } from './finance';
import { CommercialService } from './commercial';
import { commercialProposal, commercialReview } from '../../../packages/domain/commercial-policy';
import { InventoryService } from './inventory';
import { planInput } from '../../../packages/domain/saas';
import { catalogAttributes } from '../../../packages/domain/catalog-attributes';
import { AgentToolService } from './agent-tools';
import {
  contextInput,
  allocationInput,
  packInput,
  revealInput,
  keyInput,
  toolInput,
  toolResult,
  deviceEvent,
  channelSummary,
} from '../../../packages/domain/channels';
import {
  invitationSchema,
  organizationMembersSchema,
  repoolTermsSchema,
  repoolOfferSchema,
  paymentConfigurationSchema,
  paymentStatusSchema,
  paymentQueueSchema,
  apiErrorSchema,
  organizationSchema,
  repoolTerms,
} from '../../../packages/domain/contracts';
declare global {
  namespace Express {
    interface Request {
      actor: Actor | null;
      sessionToken?: string;
    }
  }
}
const text = (min = 1, max = 500) => z.string().trim().min(min).max(max);
const category = z.enum(['Sports', 'K-pop', 'Art', 'Gaming']);
const artwork = z.union([
  z.enum(['court', 'court2', 'idol', 'idol2', 'orbit', 'orbit2', 'pixel', 'pixel2']),
  z.string().regex(/^media:[a-f0-9-]{36}$/),
]);
const login = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(128) })
  .strict();
const registration = login.extend({ name: text(2, 80), password: z.string().min(12).max(128) });
const collection = z
  .object({
    org_id: text(),
    title: text(3, 100),
    description: text(20, 2000),
    category,
    artwork,
    edition_size: z.number().int().min(1).max(10000),
    rights_evidence: text(20, 4000),
  })
  .strict();
const collectionAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('submit') }),
  z.object({ action: z.literal('publish'), price_cents: z.number().int().min(100).max(10000000) }),
  z.object({
    action: z.literal('save'),
    title: text(3, 100),
    description: text(20, 2000),
    rights_evidence: text(20, 4000),
  }),
]);
const asset = z
  .object({
    title: text(3, 120),
    description: text(10, 2000),
    category,
    artwork,
    org_id: text().optional(),
    attributes: catalogAttributes.optional(),
  })
  .strict();
const listing = z
  .object({ asset_id: text(), price_cents: z.number().int().min(100).max(10000000) })
  .strict();
const quote = z
  .object({
    listing_id: text(),
    allocation_id: text().optional(),
    fulfillment: z.enum(['vault', 'ship']),
    use_credits: z.boolean().default(false),
  })
  .strict();
const checkout = z
  .object({ quote_id: text(), shipping_address: text(0, 1000).default('') })
  .strict();
const intake = z
  .object({
    asset_id: text(),
    kind: z.enum(['vault', 'repool']),
    evidence: text(10, 2000),
    accepted_terms: z.literal(true),
  })
  .strict();
const intakeDecision = z
  .object({
    action: z.enum(['receive', 'accept', 'reject', 'return']),
    note: text(10, 2000),
    grade: z.enum(['10', '9.5', '9', '8', '7', 'Ungraded']).default('9'),
  })
  .strict();
const review = z.object({ approve: z.boolean(), note: text(10, 2000) }).strict();
const stock = z
  .object({ quantity: z.number().int().min(1).max(100), evidence: text(10, 2000) })
  .strict();
const support = z
  .object({ order_id: text().optional(), subject: text(3, 150), body: text(10, 3000) })
  .strict();

export class Services {
  community: CommunityService;
  commercial: CommercialService;
  identity: IdentityService;
  access: AccessAdministration;
  managedSignIn: ManagedSignIn;
  paymentControls: PaymentControls;
  connect: ConnectService;
  evidence: EvidenceService;
  logistics: LogisticsService;
  billing: BillingService;
  finance: FinanceService;
  inventory: InventoryService;
  pricing: PricingService;
  trust: TrustService;
  privacy: PrivacyService;
  monitoring: MonitoringService;
  channels: ChannelService;
  tools: AgentToolService;
  organizations: OrganizationService;
  payments: PaymentService;
  auth: AuthService;
  catalog: CatalogService;
  commerce: CommerceService;
  operations: OperationsService;
  media: MediaService;
  constructor(
    public db: Database,
    paymentOptions: PaymentOptions = {},
    billingOptions: BillingOptions = {},
    evidenceOptions: EvidenceOptions = {},
    identityOptions: IdentityOptions = {},
  ) {
    privacyPolicy();
    this.community = new CommunityService(db);
    this.commercial = new CommercialService(db);
    this.billing = new BillingService(db, billingOptions);
    this.finance = new FinanceService(db, (actor, aid, kind) =>
      kind === 'connect_transfer'
        ? this.connect.execute(actor, aid)
        : this.paymentControls.execute(actor, aid),
    );
    this.inventory = new InventoryService(db);
    this.pricing = new PricingService(db);
    this.trust = new TrustService(db);
    this.privacy = new PrivacyService(db);
    this.monitoring = new MonitoringService(db, (record) => {
      if (process.env.TELEMETRY_LOGS === 'true') console.log(JSON.stringify(record));
    });
    this.channels = new ChannelService(db);
    this.tools = new AgentToolService(db);
    this.auth = new AuthService(db, identityOptions.staffMfaRequired);
    this.identity = new IdentityService(db, this.auth, identityOptions);
    this.organizations = new OrganizationService(db, this.identity);
    this.access = new AccessAdministration(db, this.identity);
    this.managedSignIn = new ManagedSignIn(this.identity);
    this.catalog = new CatalogService(db);
    this.commerce = new CommerceService(db, paymentOptions.provider ? 'stripe_test' : 'demo');
    this.payments = new PaymentService(db, this.commerce, paymentOptions);
    this.paymentControls = new PaymentControls(db, this.payments, this.commerce);
    this.connect = new ConnectService(db, this.paymentControls);
    this.operations = new OperationsService(db, evidenceOptions.requireCapture);
    this.evidence = new EvidenceService(db, evidenceOptions);
    this.logistics = new LogisticsService(db);
    this.media = new MediaService(db, this.evidence);
  }
}

export function createApp(s: Services) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const correlation = id();
    res.locals.correlation_id = correlation;
    res.set('X-Correlation-ID', correlation);
    const json = res.json.bind(res);
    res.json = (body: any) =>
      json(
        res.statusCode >= 400
          ? {
              ...body,
              field_errors: body.field_errors || [],
              retryable: res.statusCode === 429 || res.statusCode >= 500,
              correlation_id: correlation,
            }
          : body,
      );
    next();
  });
  app.use(s.monitoring.middleware);
  app.post(
    '/v1/webhooks/billing',
    express.raw({ type: 'application/json', limit: '256kb' }),
    async (req, res, next) => {
      try {
        res.json(await s.billing.webhook(req.body, req.get('Stripe-Signature') || ''));
      } catch (e) {
        next(e);
      }
    },
  );
  // Stripe signs raw bytes; mount before JSON parsing and cookie/CSRF middleware.
  app.post(
    '/v1/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '256kb' }),
    async (req, res, next) => {
      try {
        const signature = req.get('Stripe-Signature') || '';
        res.json(
          (await s.paymentControls.webhook(req.body, signature)) ??
            (await s.payments.webhook(req.body, signature)),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  app.post(
    '/v1/devices/:id/events',
    express.raw({ type: 'application/json', limit: '64kb' }),
    async (req, res, next) => {
      res.set('Cache-Control', 'no-store');
      try {
        res.json(
          await s.channels.event(
            String(req.params.id),
            req.body,
            req.get('X-Device-Timestamp') || '',
            req.get('X-Device-Signature') || '',
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(
    express.raw({
      type: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'],
      limit: '10mb',
    }),
  );
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = (req.headers.cookie || '')
        .split(';')
        .map((x) => x.trim())
        .find((x) => x.startsWith('pixup_session='))
        ?.slice(14);
      req.sessionToken = token;
      req.actor = await s.auth.session(token);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (
          !req.is('application/json') &&
          !(req.path === '/v1/uploads' && req.is(['image/png', 'image/jpeg', 'image/webp'])) &&
          !(
            /^\/v1\/evidence\/[^/]+\/bytes$/.test(req.path) &&
            req.is(['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
          )
        )
          return res.status(415).json({
            code: 'JSON_REQUIRED',
            message: 'Send JSON, or a supported image to the upload endpoint.',
          });
        const origin = req.get('Origin'),
          allowed = [process.env.APP_ORIGIN || 'http://127.0.0.1:3000', 'http://localhost:3000'];
        if (origin && !allowed.includes(origin))
          return res
            .status(403)
            .json({ code: 'ORIGIN_REJECTED', message: 'Request origin is not allowed.' });
        if (req.actor && req.get('X-CSRF-Token') !== req.actor.csrf)
          return res.status(403).json({
            code: 'CSRF_REJECTED',
            message: 'Session validation failed. Refresh and try again.',
          });
      }
      const allowedMfa = [
        '/v1/me',
        '/v1/auth/logout',
        '/v1/identity/status',
        '/v1/identity/mfa/enroll',
        '/v1/identity/mfa/verify',
      ];
      if (req.actor?.mfa_required && !allowedMfa.includes(req.path))
        return res.status(403).json({
          code: 'MFA_REQUIRED',
          message: 'Complete authenticator verification in Account security.',
        });
      withDatabaseActor(req.actor?.id || '', () => next());
    } catch (error) {
      next(error);
    }
  });
  const paths: Record<string, any> = {};
  type Handler = (r: Request, res: Response, d: any) => Promise<unknown> | unknown;
  const route = (
    method: 'get' | 'post',
    path: string,
    handler: Handler,
    schema?: z.ZodType,
    responseSchema?: z.ZodType,
  ) => {
    const openPath = path.replace(/:([a-z_]+)/g, '{$1}');
    paths[openPath] ??= {};
    paths[openPath][method] = {
      summary: method.toUpperCase() + ' ' + path,
      responses: {
        200: {
          description: 'Successful response',
          ...(responseSchema
            ? { content: { 'application/json': { schema: z.toJSONSchema(responseSchema) } } }
            : {}),
        },
        400: {
          description: 'Validation failed',
          content: { 'application/json': { schema: z.toJSONSchema(apiErrorSchema) } },
        },
        401: {
          description: 'Sign in required',
          content: { 'application/json': { schema: z.toJSONSchema(apiErrorSchema) } },
        },
        403: {
          description: 'Insufficient permissions',
          content: { 'application/json': { schema: z.toJSONSchema(apiErrorSchema) } },
        },
        409: {
          description: 'State conflict',
          content: { 'application/json': { schema: z.toJSONSchema(apiErrorSchema) } },
        },
      },
      ...(schema
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: z.toJSONSchema(schema) } },
            },
          }
        : {}),
      parameters: [...path.matchAll(/:([a-z_]+)/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
    };
    app[method]('/v1' + path, async (req, res, next) => {
      try {
        const result = await handler(req, res, schema ? schema.parse(req.body) : req.body);
        if (!res.headersSent) res.json(result);
      } catch (error) {
        next(error);
      }
    });
  };
  const user = (r: Request) => requireUser(r.actor);
  const param = (r: Request, name = 'id') => String(r.params[name]);
  const session = (res: Response, result: any) => {
    res.cookie('pixup_session', result.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/',
      maxAge: 7 * 86400000,
    });
    return { user: result.user };
  };

  route('post', '/organizations/:org/invitations/:id/resend', (r) =>
    s.organizations.resendInvitation(user(r), param(r, 'org'), param(r)),
  );
  route('get', '/identity/config', () => ({
    managed_enabled: !!s.identity.options.oidc,
    mail_enabled: !!s.identity.options.mail,
  }));
  route('get', '/identity/status', (r) => s.identity.status(user(r)));
  route('post', '/identity/verify-email', (r) => s.identity.verifyEmail(user(r)));
  route(
    'post',
    '/identity/reset-request',
    (_r, _res, d) => s.identity.resetRequest(d.email),
    z.object({ email: z.email().max(254) }).strict(),
  );
  route(
    'post',
    '/identity/consume',
    (r, _res, d) => s.identity.consume(r.actor || null, d.token, d.password),
    z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        password: z.string().min(12).max(128).optional(),
      })
      .strict(),
  );
  route(
    'post',
    '/identity/reauthenticate',
    (r, _res, d) => s.identity.reauthenticate(user(r), r.sessionToken!, d.password),
    z.object({ password: z.string().max(128) }).strict(),
  );
  route(
    'post',
    '/identity/mfa/enroll',
    (r, _res, d) => s.identity.enroll(user(r), d.password),
    z.object({ password: z.string().max(128).default('') }).strict(),
  );
  route(
    'post',
    '/identity/mfa/verify',
    (r, _res, d) => s.identity.verifyMfa(user(r), r.sessionToken!, d.code, d.enrollment),
    z
      .object({
        code: z.string().regex(/^(?:[0-9]{6}|[a-f0-9]{24})$/),
        enrollment: z.boolean().default(false),
      })
      .strict(),
  );
  route(
    'post',
    '/identity/mfa/replace',
    (r, _res, d) => s.identity.enroll(user(r), d.password, true),
    z.object({ password: z.string().max(128).default('') }).strict(),
  );
  route('get', '/identity/sessions', (r) => s.identity.sessions(user(r), r.sessionToken!));
  route('post', '/identity/sessions/revoke-others', (r) =>
    s.identity.revokeSessions(user(r), r.sessionToken!),
  );
  route('get', '/identity/owner-transfers', (r) => s.access.transfers(user(r)));
  route(
    'post',
    '/organizations/:id/owner-transfer',
    (r, _res, d) => s.access.transfer(user(r), param(r), d.user_id),
    z.object({ user_id: text() }).strict(),
  );
  route(
    'post',
    '/identity/owner-transfers/:id/decide',
    (r, _res, d) => s.access.decideTransfer(user(r), param(r), d.accept),
    z.object({ accept: z.boolean() }).strict(),
  );
  route('get', '/ops/access', (r) => s.access.dashboard(user(r)));
  route(
    'post',
    '/ops/access',
    (r, _res, d) => s.access.request(user(r), d.user_id, d.permissions, d.reason),
    z
      .object({
        user_id: text(),
        permissions: z.array(z.enum(staffPermissions)).max(staffPermissions.length),
        reason: text(10, 2000),
      })
      .strict(),
  );
  route(
    'post',
    '/ops/access/:id/decide',
    (r, _res, d) => s.access.decide(user(r), param(r), d.approve, d.note),
    z.object({ approve: z.boolean(), note: text(10, 2000) }).strict(),
  );
  route('post', '/identity/oidc/start', async (_r, res) => {
    const result = await s.managedSignIn.start();
    res.cookie('pixup_oidc', result.browser, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      path: '/api/identity/oidc/callback',
      maxAge: 600000,
    });
    return { url: result.url };
  });
  app.get('/v1/identity/oidc/callback', async (req, res) => {
    res.set('Referrer-Policy', 'no-referrer');
    try {
      const browser =
        (req.headers.cookie || '')
          .split(';')
          .map((x) => x.trim())
          .find((x) => x.startsWith('pixup_oidc='))
          ?.slice(11) || '';
      const state = z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .parse(req.query.state);
      const origin = s.identity.options.origin || 'http://127.0.0.1:3000';
      const callback = new URL('/api/identity/oidc/callback', origin);
      for (const [key, value] of Object.entries(req.query))
        if (typeof value === 'string') callback.searchParams.set(key, value);
      session(res, await s.managedSignIn.callback(state, browser, callback.href));
      res.clearCookie('pixup_oidc', { path: '/api/identity/oidc/callback' });
      res.redirect(303, origin + '/account/security');
    } catch {
      res.clearCookie('pixup_oidc', { path: '/api/identity/oidc/callback' });
      res.redirect(
        303,
        (s.identity.options.origin || 'http://127.0.0.1:3000') + '/login?identity_error=1',
      );
    }
  });
  route('get', '/community/config', () => s.community.config());
  route('get', '/community/me', (r) => s.community.me(user(r)));
  route(
    'post',
    '/community/me/profile',
    (r, _res, d) => s.community.profile(user(r), d),
    community.communityProfileInput,
  );
  route(
    'post',
    '/community/guidelines/accept',
    (r, _res, d) => s.community.accept(user(r), d),
    community.communityAcceptInput,
  );
  route('get', '/community/topics', (r) => s.community.topics(user(r)));
  route(
    'post',
    '/community/topic-suggestions',
    (r, _res, d) => s.community.suggestion(user(r), d),
    community.communitySuggestionInput,
  );
  route('get', '/community/profiles/:id', (r) => s.community.member(user(r), param(r)));
  route('get', '/community/posts', (r) => s.community.feed(user(r), r.query));
  route('get', '/community/posts/:id', (r) => s.community.detail(user(r), param(r)));
  route(
    'post',
    '/community/posts',
    (r, _res, d) => s.community.create(user(r), d, r.get('Idempotency-Key') || ''),
    community.communityPostInput,
  );
  route(
    'post',
    '/community/posts/:id/edit',
    (r, _res, d) => s.community.edit(user(r), param(r), d),
    community.communityEditInput,
  );
  route(
    'post',
    '/community/posts/:id/publish',
    (r, _res, d) => s.community.publish(user(r), param(r), d),
    community.communityVersionInput,
  );
  route(
    'post',
    '/community/posts/:id/delete',
    (r, _res, d) => s.community.remove(user(r), param(r), d),
    community.communityVersionInput,
  );
  route('get', '/community/posts/:id/comments', (r) =>
    s.community.comments(user(r), param(r), r.query.cursor || ''),
  );
  route(
    'post',
    '/community/posts/:id/comments',
    (r, _res, d) => s.community.comment(user(r), param(r), d, r.get('Idempotency-Key') || ''),
    community.communityCommentInput,
  );
  route(
    'post',
    '/community/comments/:id/edit',
    (r, _res, d) => s.community.edit(user(r), param(r), d, true),
    community.communityCommentEditInput,
  );
  route(
    'post',
    '/community/comments/:id/delete',
    (r, _res, d) => s.community.remove(user(r), param(r), d),
    community.communityVersionInput,
  );
  route(
    'post',
    '/community/relations',
    (r, _res, d) => s.community.relation(user(r), d),
    community.communityRelationInput,
  );
  route('get', '/community/me/recovery', (r) => s.community.recovery(user(r)));
  route('get', '/community/me/notifications', (r) => s.community.notifications(user(r)));
  route(
    'post',
    '/community/reports',
    (r, _res, d) => s.community.report(user(r), d),
    community.communityReportInput,
  );
  route(
    'post',
    '/community/appeals',
    (r, _res, d) => s.community.appeal(user(r), d),
    community.communityAppealInput,
  );
  route('get', '/ops/community', (r) => s.community.queue(user(r)));
  route(
    'post',
    '/ops/community/topics',
    (r, _res, d) => s.community.topic(user(r), d),
    community.communityTopicInput,
  );
  route(
    'post',
    '/ops/community/entries/:id',
    (r, _res, d) => s.community.decide(user(r), param(r), d),
    community.communityDecisionInput,
  );
  route(
    'post',
    '/ops/community/appeals/:id',
    (r, _res, d) => s.community.decideAppeal(user(r), param(r), d),
    community.communityAppealDecisionInput,
  );
  route('get', '/privacy/policy', () => privacyPolicy());
  route('get', '/billing/plans', (r) => s.billing.plans(user(r)));
  route('get', '/billing/accounts/:org', (r) => s.billing.account(user(r), param(r, 'org')));
  route(
    'post',
    '/billing/accounts/:org/checkout',
    (r, _res, d) => s.billing.start(user(r), param(r, 'org'), d.plan_id),
    z.object({ plan_id: text() }).strict(),
  );
  route('post', '/billing/subscriptions/:id/refresh', (r) => s.billing.resume(user(r), param(r)));
  route('post', '/billing/subscriptions/:id/cancel', (r) => s.billing.cancel(user(r), param(r)));
  route('get', '/ops/billing', (r) => s.billing.dashboard(user(r)));
  route(
    'post',
    '/ops/billing/subscriptions/:id/recover',
    (r, _res, d) => s.billing.recover(user(r), param(r), d.session_id, d.reason),
    z
      .object({ session_id: z.string().startsWith('cs_test_').max(200), reason: text(10, 2000) })
      .strict(),
  );
  route('post', '/ops/billing/plans', (r, _res, d) => s.billing.createPlan(user(r), d), planInput);
  route('get', '/ops/approvals', (r) => s.finance.queue(user(r)));
  route('get', '/ops/commercial', (r) => s.commercial.dashboard(user(r)));
  route(
    'post',
    '/ops/commercial/decisions',
    (r, _res, d) => s.commercial.propose(user(r), d),
    commercialProposal,
  );
  route(
    'post',
    '/ops/commercial/decisions/:id/review',
    (r, _res, d) => s.commercial.review(user(r), param(r), d),
    commercialReview,
  );
  route(
    'post',
    '/ops/approvals',
    (r, _res, d) => s.finance.request(user(r), d.kind, d.resource_id, d.reason),
    z
      .object({
        kind: z.enum(['plan_activate', 'plan_retire', 'settlement_release']),
        resource_id: text(),
        reason: text(10, 2000),
      })
      .strict(),
  );
  route(
    'post',
    '/ops/approvals/:id/decision',
    (r, _res, d) => s.finance.decide(user(r), param(r), d.version, d.decision, d.note),
    z
      .object({
        version: z.number().int().positive(),
        decision: z.enum(['approve', 'reject']),
        note: text(10, 2000),
      })
      .strict(),
  );
  route('post', '/ops/approvals/:id/execute', (r) => s.finance.execute(user(r), param(r)));
  route('get', '/inventory/:org', (r) => s.inventory.list(user(r), param(r, 'org')));
  route(
    'post',
    '/inventory/:org/assignments',
    (r, _res, d) =>
      s.finance.request(user(r), 'inventory_assign', d.asset_id, d.reason, param(r, 'org')),
    z.object({ asset_id: text(), reason: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/assets/:id/attributes',
    (r, _res, d) => s.inventory.attributes(user(r), param(r), d),
    catalogAttributes,
  );
  route('get', '/ops/pricing', (r) => s.pricing.dashboard(user(r)));
  route(
    'post',
    '/ops/pricing/cohorts',
    (r, _res, d) => s.pricing.cohort(user(r), d),
    z
      .object({
        label: text(3, 100),
        definition: text(20, 2000),
        grade: text(1, 50),
        asset_ids: z
          .array(text())
          .min(1)
          .max(100)
          .refine((a) => new Set(a).size === a.length, 'Duplicate asset IDs'),
      })
      .strict(),
  );
  route(
    'post',
    '/ops/pricing/observations',
    (r, _res, d) => s.pricing.observe(user(r), d),
    z
      .object({
        cohort_id: text(),
        source: text(3, 100),
        source_reference: text(1, 200),
        permission_evidence: text(10, 2000),
        evidence: text(10, 2000),
        amount_cents: z.number().int().min(1).max(100000000),
        occurred_at: z.iso.datetime(),
        final_sale: z.boolean(),
        related_party: z.boolean(),
      })
      .strict(),
  );
  route(
    'post',
    '/ops/pricing/observations/:id/review',
    (r, _res, d) => s.pricing.review(user(r), param(r), d.decision, d.reason),
    z.object({ decision: z.enum(['include', 'exclude']), reason: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/ops/pricing/cohorts/:id/snapshots',
    (r, _res, d) => s.pricing.snapshot(user(r), param(r), d.lane),
    z.object({ lane: z.enum(['simulation', 'external']) }).strict(),
  );
  route('get', '/ops/trust', (r) => s.trust.dashboard(user(r)));
  route(
    'post',
    '/ops/trust/requests',
    (r, _res, d) => s.trust.request(user(r), d.kind, d.resource_id),
    z
      .object({
        kind: z.enum(['certificate', 'checkpoint']),
        resource_id: z.string().max(100).default(''),
      })
      .strict(),
  );
  route(
    'post',
    '/ops/trust/signatures',
    (r, _res, d) => s.trust.accept(user(r), d.request_id, d.key_id, d.signature),
    z
      .object({
        request_id: text(),
        key_id: text(1, 100),
        signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
      })
      .strict(),
  );
  route('get', '/privacy', (r) => s.privacy.profile(user(r)));
  route(
    'post',
    '/privacy/consent',
    (r, _res, d) => s.privacy.consent(user(r), d),
    z
      .object({
        adult: z.boolean(),
        terms_version: text(),
        privacy_version: text(),
        marketing_opt_in: z.boolean().default(false),
      })
      .strict(),
  );
  route(
    'post',
    '/privacy/preferences',
    (r, _res, d) => s.privacy.preferences(user(r), d.marketing_opt_in),
    z.object({ marketing_opt_in: z.boolean() }).strict(),
  );
  route(
    'post',
    '/privacy/requests',
    (r, _res, d) => s.privacy.request(user(r), d.kind, d.note),
    z.object({ kind: z.enum(['restrict', 'delete', 'age_review']), note: text(10, 2000) }).strict(),
  );
  route('post', '/privacy/export', async (r, res) => {
    res.set('Content-Disposition', 'attachment; filename="pixup-account-data.json"');
    return s.privacy.export(user(r));
  });
  route('get', '/ops/privacy', (r) => s.privacy.queue(user(r)));
  route(
    'post',
    '/ops/privacy/:id',
    (r, _res, d) => s.privacy.decide(user(r), param(r), d.action, d.note),
    z
      .object({ action: z.enum(['complete', 'reject', 'restore_access']), note: text(10, 2000) })
      .strict(),
  );
  route('get', '/ready', async (_r, res) => {
    const ready = await s.monitoring.ready();
    if (!ready.ok) res.status(503);
    return ready;
  });
  route('get', '/ops/monitoring', (r) => s.monitoring.dashboard(user(r)));
  route(
    'post',
    '/ops/monitoring/:id/acknowledge',
    (r, _res, d) => s.monitoring.acknowledge(user(r), param(r), d.note),
    z.object({ note: text(10, 2000) }).strict(),
  );
  app.get('/v1/metrics', async (req, res, next) => {
    try {
      s.monitoring.authorize(req.actor, req.get('Authorization') || '');
      res.type('text/plain').send(await s.monitoring.prometheus());
    } catch (e) {
      next(e);
    }
  });
  route('get', '/channels', () => s.channels.browse(), undefined, z.array(channelSummary));
  route('get', '/channels/workspace', (r) => s.channels.workspace(user(r)));
  route('get', '/channels/:id', (r) => s.channels.detail(param(r), r.actor));
  route('post', '/channels', (r, _res, d) => s.channels.create(user(r), d), contextInput);
  route(
    'post',
    '/channels/:id/allocations',
    (r, _res, d) => s.channels.assign(user(r), param(r), d),
    allocationInput,
  );
  route(
    'post',
    '/channels/:id/status',
    (r, _res, d) => s.channels.status(user(r), param(r), d.status),
    z.object({ status: z.enum(['open', 'paused', 'canceled']) }).strict(),
  );
  route('post', '/channels/allocations/:id/unpledge', (r) =>
    s.channels.unpledge(user(r), param(r)),
  );
  route('post', '/channels/:id/lock', (r) => s.channels.lockGroup(user(r), param(r)));
  route(
    'post',
    '/channels/allocations/:id/release',
    (r, _res, d) => s.channels.release(user(r), param(r), d.evidence),
    z.object({ evidence: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/channels/allocations/:id/pledge',
    (r, _res, d) => s.channels.pledge(user(r), param(r), d.terms_version),
    z.object({ terms_version: z.number().int().positive() }).strict(),
  );
  route(
    'post',
    '/channels/orders/:id/reveal',
    (r, _res, d) => s.channels.reveal(user(r), param(r), d),
    revealInput,
  );
  route(
    'post',
    '/channels/orders/:id/return',
    (r, _res, d) => s.channels.wholesaleReturn(user(r), param(r), d.note),
    z.object({ note: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/channels/:id/returns',
    (r, _res, d) => s.channels.returnClaim(user(r), param(r), d.asset_id),
    z.object({ asset_id: text() }).strict(),
  );
  route('get', '/ops/channels/gates', (r) => s.channels.gates(user(r)));
  route(
    'post',
    '/ops/channels/gates/:id',
    (r, _res, d) => s.channels.setGate(user(r), param(r), d.enabled, d.evidence),
    z.object({ enabled: z.boolean(), evidence: text(10, 2000) }).strict(),
  );
  route('post', '/ops/channels/packs', (r, _res, d) => s.channels.pack(user(r), d), packInput);
  route(
    'post',
    '/ops/channels/businesses',
    (r, _res, d) => s.channels.business(user(r), d.user_id, d.org_id, d.approved),
    z.object({ user_id: text(), org_id: text(), approved: z.boolean() }).strict(),
  );
  route(
    'post',
    '/ops/channels/orders/:id/fulfill',
    (r, _res, d) => s.channels.fulfill(user(r), param(r), d.evidence),
    z.object({ evidence: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/ops/channels/returns/:id/receive',
    (r, _res, d) => s.channels.receiveReturn(user(r), param(r), d.evidence),
    z.object({ evidence: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/ops/channels/orders/:id/return-decision',
    (r, _res, d) => s.channels.decideWholesaleReturn(user(r), param(r), d.approved, d.note),
    z.object({ approved: z.boolean(), note: text(10, 2000) }).strict(),
  );
  route('post', '/ops/channels/devices/:id/revoke', (r) =>
    s.channels.revokeDevice(user(r), param(r)),
  );
  route(
    'post',
    '/ops/channels/commands/:id/reconcile',
    (r, _res, d) => s.channels.reconcileVend(user(r), param(r), d.outcome, d.evidence),
    z
      .object({ outcome: z.enum(['delivered', 'not_dispensed']), evidence: text(10, 2000) })
      .strict(),
  );
  route('get', '/tools/keys', (r) => s.tools.keys(user(r)));
  route('post', '/tools/keys', (r, _res, d) => s.tools.create(user(r), d), keyInput);
  route('post', '/tools/keys/:id/revoke', (r) => s.tools.revoke(user(r), param(r)));
  route(
    'post',
    '/tools/:operation',
    (r, _res, d) => s.tools.execute(r.get('Authorization') || '', param(r, 'operation'), d),
    toolInput,
    toolResult,
  );
  route('get', '/health', () => ({
    ok: true,
    mode: 'demo',
    payments: s.payments.configuration().provider,
    version: '0.1.0',
  }));
  route(
    'get',
    '/payments/config',
    () => s.payments.configuration(),
    undefined,
    paymentConfigurationSchema,
  );
  route(
    'post',
    '/orders/:id/stripe-checkout',
    (r) => s.payments.start(user(r), param(r)),
    undefined,
    paymentStatusSchema,
  );
  route(
    'post',
    '/orders/:id/payment-status',
    (r) => s.payments.status(user(r), param(r)),
    undefined,
    paymentStatusSchema,
  );
  route(
    'post',
    '/orders/:id/cancel-payment',
    (r) => s.payments.cancel(user(r), param(r)),
    undefined,
    paymentStatusSchema,
  );
  route('get', '/me', (r) => ({ user: r.actor, mode: 'demo' }));
  route(
    'get',
    '/ops/payments',
    (r) => s.payments.queue(user(r), z.string().max(100).optional().parse(r.query.cursor)),
    undefined,
    paymentQueueSchema,
  );
  route(
    'post',
    '/ops/payments/:id/claim',
    (r, _res, d) => s.payments.claim(user(r), param(r), d.expected_version),
    z.object({ expected_version: z.number().int().positive() }).strict(),
  );
  route(
    'post',
    '/ops/payments/:id/reconcile',
    (r, _res, d) => s.payments.review(user(r), param(r), d),
    z
      .object({
        session_id: z
          .string()
          .regex(/^cs_test_[A-Za-z0-9_-]+$/)
          .max(255)
          .optional(),
        expected_version: z.number().int().positive(),
        note: text(10, 2000),
        cancel: z.boolean().default(false),
      })
      .strict(),
    paymentStatusSchema,
  );
  route(
    'post',
    '/ops/payments/:id/refund',
    (r, _res, d) => s.payments.requestRefund(user(r), param(r), d.reason),
    z.object({ reason: text(10, 2000) }).strict(),
    paymentStatusSchema,
  );
  route(
    'post',
    '/ops/payments/:id/refund-status',
    (r, _res, d) => s.payments.reconcileRefund(user(r), param(r), d),
    z
      .object({
        refund_id: z
          .string()
          .regex(/^re_[A-Za-z0-9_-]+$/)
          .max(255)
          .optional(),
        note: text(10, 2000),
      })
      .strict(),
    paymentStatusSchema,
  );
  route(
    'get',
    '/me/organizations',
    (r) => user(r).organizations,
    undefined,
    z.array(organizationSchema),
  );
  route(
    'get',
    '/me/invitations',
    (r) => s.organizations.invitations(user(r)),
    undefined,
    z.array(invitationSchema),
  );
  route(
    'get',
    '/organizations/:org/members',
    (r) => s.organizations.members(user(r), param(r, 'org')),
    undefined,
    organizationMembersSchema,
  );
  route(
    'post',
    '/organizations/:org/invitations',
    (r, res, d) => s.organizations.invite(user(r), param(r, 'org'), d.email, d.role),
    z.object({ email: z.email().max(254), role: z.enum(['publisher', 'viewer']) }).strict(),
  );
  route('post', '/invitations/:id/accept', (r) => s.organizations.accept(user(r), param(r)));
  route('post', '/organizations/:org/invitations/:id/revoke', (r) =>
    s.organizations.revokeInvitation(user(r), param(r, 'org'), param(r)),
  );
  route('post', '/organizations/:org/members/:id/revoke', (r) =>
    s.organizations.revokeMember(user(r), param(r, 'org'), param(r)),
  );
  route('get', '/repool/terms', () => repoolTerms, undefined, repoolTermsSchema);
  route(
    'get',
    '/repool/intakes/:id/offer',
    (r) => s.operations.offer(user(r), param(r)),
    undefined,
    repoolOfferSchema,
  );
  route(
    'post',
    '/repool/intakes/:id/offer/decision',
    (r, res, d) => s.operations.decideOffer(user(r), param(r), d),
    z.object({ expected_version: z.number().int().positive(), accept: z.boolean() }).strict(),
  );
  route(
    'post',
    '/ops/intakes/:id/reoffer',
    (r, res, d) => s.operations.reoffer(user(r), param(r), d),
    z
      .object({
        expected_version: z.number().int().positive(),
        credit_units: z.number().int().min(1).max(1000000),
        note: text(10, 2000),
      })
      .strict(),
  );
  route('post', '/uploads', (r) => s.media.upload(user(r), r.body));
  route('get', '/ops/payment-controls', (r) => s.paymentControls.dashboard(user(r)));
  route(
    'post',
    '/ops/payments/:id/partial-refund',
    (r, _res, d) => s.paymentControls.requestPartial(user(r), param(r), d),
    partialInput,
  );
  route(
    'post',
    '/ops/payments/:id/retry-refund',
    (r, _res, d) => s.paymentControls.requestRetry(user(r), param(r), d.reason),
    z.object({ reason: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/ops/payments/:id/bind-scope',
    (r, _res, d) => s.payments.bindScope(user(r), param(r), d.session_id, d.note),
    z.object({ session_id: text(5, 255), note: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/ops/payments/:id/external-reconcile',
    (r) => s.paymentControls.reconcile(user(r), param(r)),
    z.object({}).strict(),
  );
  route(
    'post',
    '/ops/partial-refunds/:id/refresh',
    (r, _res, d) => s.paymentControls.refreshPartial(user(r), param(r), d.refund_id, d.note),
    z.object({ refund_id: text(3, 255).optional(), note: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/ops/disputes/:id/refresh',
    (r, _res, d) => s.paymentControls.dispute(user(r), param(r), d.note),
    z.object({ note: text(10, 2000) }).strict(),
  );
  route('get', '/orders/:id/payment-adjustments', (r) =>
    s.paymentControls.order(user(r), param(r)),
  );
  route('get', '/connect', (r) => s.connect.status(user(r)));
  route(
    'post',
    '/connect/onboard',
    (r, _res, d) => s.connect.onboard(user(r), d.country),
    z.object({ country: z.string().regex(/^[A-Z]{2}$/), accepted_terms: z.literal(true) }).strict(),
  );
  route('post', '/connect/link', (r) => s.connect.link(user(r)), z.object({}).strict());
  route('post', '/connect/refresh', (r) => s.connect.refresh(user(r)), z.object({}).strict());
  route('get', '/ops/connect', (r) => s.connect.dashboard(user(r)));
  route(
    'post',
    '/ops/connect/:id/recover',
    (r, _res, d) => s.connect.recover(user(r), param(r), d.account_id, d.note),
    z.object({ account_id: text(5, 255), note: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/ops/settlements/:id/test-transfer',
    (r, _res, d) => s.connect.request(user(r), param(r), d.reason),
    z.object({ reason: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/ops/transfers/:id/reconcile',
    (r, _res, d) => s.connect.recoverTransfer(user(r), param(r), d.transfer_id, d.note),
    z.object({ transfer_id: text(3, 255).optional(), note: text(10, 2000) }).strict(),
  );
  route('get', '/evidence', (r) => s.evidence.list(user(r)));
  route('post', '/evidence', (r, _res, d) => s.evidence.reserve(user(r), d), fileInput);
  route('post', '/evidence/:id/bytes', (r) => s.evidence.upload(user(r), param(r), r.body));
  route(
    'post',
    '/ops/evidence/:id/review',
    (r, _res, d) => s.evidence.review(user(r), param(r), d.approve, d.note),
    review,
  );
  route(
    'post',
    '/ops/evidence/:id/hold',
    (r, _res, d) => s.evidence.hold(user(r), param(r), d.hold, d.note),
    z.object({ hold: z.boolean(), note: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/ops/evidence/:id/purge',
    (r, _res, d) => s.evidence.purge(user(r), param(r), d.note),
    z.object({ note: text(10, 2000) }).strict(),
  );
  app.get('/v1/evidence/:id/download', async (req, res, next) => {
    try {
      const f = await s.evidence.read(user(req), String(req.params.id));
      res.set({
        'Content-Type': f.mime,
        'Content-Disposition': `attachment; filename="evidence-${req.params.id}.${f.mime === 'application/pdf' ? 'pdf' : 'image'}"`,
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.send(f.bytes);
    } catch (e) {
      next(e);
    }
  });
  route('get', '/ops/logistics', (r) => s.logistics.dashboard(user(r)));
  route(
    'post',
    '/ops/intakes/:id/capture',
    (r, _res, d) => s.logistics.capture(user(r), param(r), d),
    captureInput,
  );
  route(
    'post',
    '/ops/orders/:id/shipment',
    (r, _res, d) => s.logistics.createShipment(user(r), param(r), d),
    shipmentInput,
  );
  route(
    'post',
    '/ops/shipments/:id/events',
    (r, _res, d) => s.logistics.event(user(r), param(r), d),
    trackingInput,
  );
  route('post', '/incidents', (r, _res, d) => s.logistics.incident(user(r), d), incidentInput);
  route(
    'post',
    '/ops/incidents/:id/resolve',
    (r, _res, d) => s.logistics.resolve(user(r), param(r), d.expected_version, d.note),
    z.object({ expected_version: z.number().int().positive(), note: text(10, 2000) }).strict(),
  );
  route('get', '/orders/:id/shipment', (r) => s.logistics.order(user(r), param(r)));
  app.get('/v1/media/:id', async (req, res, next) => {
    try {
      const media = await s.media.read(String(req.params.id), req.actor);
      res.set({
        'Content-Type': 'image/webp',
        'Content-Security-Policy': "default-src 'none'",
        'Cache-Control': 'private, no-store',
      });
      res.send(Buffer.from(media.data));
    } catch (error) {
      next(error);
    }
  });
  route(
    'post',
    '/auth/login',
    async (r, res, d) => session(res, await s.auth.login(d.email, d.password)),
    login,
  );
  route(
    'post',
    '/auth/register',
    async (r, res, d) => session(res, await s.auth.register(d.name, d.email, d.password)),
    registration,
  );
  route('post', '/auth/logout', async (r, res) => {
    if (r.sessionToken) await s.auth.logout(r.sessionToken);
    res.clearCookie('pixup_session', { path: '/' });
    return { ok: true };
  });
  route('get', '/catalog', () => s.catalog.browse());
  route('get', '/assets/:id', (r) => s.catalog.item(param(r), r.actor));
  route('get', '/collections/:id', (r) => s.catalog.collection(param(r)));
  route('get', '/certificates/:id/verify', (r) => s.catalog.verify(param(r)));
  route('get', '/portfolio', (r) => s.catalog.portfolio(user(r)));
  route(
    'post',
    '/saved/:id',
    (r, res, d) => s.catalog.save(user(r), param(r), d.saved),
    z.object({ saved: z.boolean() }),
  );
  route('get', '/creator/:org', (r) => s.catalog.creator(user(r), param(r, 'org')));
  route('post', '/collections', (r, res, d) => s.catalog.createCollection(user(r), d), collection);
  route(
    'post',
    '/collections/:id/actions',
    (r, res, d) => s.catalog.collectionAction(user(r), param(r), d.action, d),
    collectionAction,
  );
  route('post', '/assets', (r, res, d) => s.catalog.createAsset(user(r), d), asset);
  route(
    'post',
    '/listings',
    (r, res, d) => s.catalog.list(user(r), d.asset_id, d.price_cents),
    listing,
  );
  route('post', '/listings/:id/withdraw', (r) => s.catalog.withdrawListing(user(r), param(r)));
  route('post', '/quotes', (r, res, d) => s.commerce.quote(user(r), d), quote);
  route(
    'post',
    '/checkouts',
    (r, res, d) => s.commerce.checkout(user(r), d, r.get('Idempotency-Key') || ''),
    checkout,
  );
  route(
    'post',
    '/orders/:id/demo-payment',
    (r, res, d) => s.commerce.pay(user(r), param(r), d.success),
    z.object({ success: z.boolean() }),
  );
  route('get', '/orders', (r) => s.commerce.orders(user(r)));
  route('get', '/orders/:id', (r) => s.commerce.order(user(r), param(r)));
  route('post', '/orders/:id/refund', (r) => s.commerce.refund(user(r), param(r)));
  route('get', '/credits', (r) => s.commerce.credits(user(r)));
  route('get', '/settlements', (r) => s.commerce.settlements(user(r)));
  route('post', '/intakes', (r, res, d) => s.operations.intake(user(r), d), intake);
  route('get', '/activity', (r) => s.operations.activity(user(r)));
  route('get', '/support', (r) => s.operations.cases(user(r)));
  route('post', '/support', (r, res, d) => s.operations.support(user(r), d), support);
  route('get', '/ops', (r) => s.operations.dashboard(user(r)));
  route(
    'post',
    '/ops/collections/:id/review',
    (r, res, d) => s.operations.reviewCollection(user(r), param(r), d),
    review,
  );
  route(
    'post',
    '/ops/collections/:id/stock',
    (r, res, d) => s.operations.receiveStock(user(r), param(r), d),
    stock,
  );
  route(
    'post',
    '/ops/intakes/:id',
    (r, res, d) => s.operations.intakeAction(user(r), param(r), d),
    intakeDecision,
  );
  route(
    'post',
    '/ops/assets/:id/revoke',
    (r, res, d) => s.operations.revoke(user(r), param(r), d.note),
    z.object({ note: text(10, 2000) }),
  );
  route(
    'post',
    '/ops/settlements/:id/release',
    (r, _res, d) => s.finance.request(user(r), 'settlement_release', param(r), d.reason),
    z.object({ reason: text(10, 2000) }).strict(),
  );
  route(
    'post',
    '/ops/orders/:id/fulfill',
    (r, res, d) => s.operations.fulfill(user(r), param(r), d.tracking),
    z.object({ tracking: text(5, 150) }),
  );
  route(
    'post',
    '/ops/support/:id/resolve',
    (r, res, d) => s.operations.resolveCase(user(r), param(r), d.response),
    z.object({ response: text(10, 2000) }),
  );
  paths['/devices/{id}/events'] = {
    post: {
      summary: 'Signed device heartbeat, vend outcome or deposit receipt',
      description:
        'Ed25519 signature over device ID, newline, Unix milliseconds, newline, and the original UTF-8 body. Event IDs deduplicate identical bodies. Cookie CSRF does not apply.',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ...['X-Device-Timestamp', 'X-Device-Signature'].map((name) => ({
          name,
          in: 'header',
          required: true,
          schema: { type: 'string' },
        })),
      ],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: z.toJSONSchema(deviceEvent) } },
      },
      responses: {
        200: { description: 'Stored event result; heartbeat may include signed commands' },
        401: { description: 'Invalid signature, stale timestamp or revoked device' },
        409: { description: 'Event identity or physical outcome conflict' },
      },
    },
  };
  paths['/tools/{operation}'].post.security = [{ toolBearer: [] }];
  paths['/tools/{operation}'].post.parameters[0].schema.enum = ['query', 'match', 'route'];
  app.get('/v1/openapi.json', (req, res) =>
    res.json({
      openapi: '3.1.0',
      info: {
        title: 'PixUP demo API',
        version: '0.1.0',
        description:
          'Cookie sessions; authenticated mutations require X-CSRF-Token from /me. Checkout requires Idempotency-Key. Simulated money only.',
      },
      servers: [{ url: '/api' }],
      components: {
        securitySchemes: {
          toolBearer: {
            type: 'http',
            scheme: 'bearer',
            description:
              'Scoped, revocable Query/Match/Route credential; current membership and quota are checked per call.',
          },
        },
      },
      paths,
    }),
  );
  app.use((req, res) =>
    res.status(404).json({ code: 'NOT_FOUND', message: 'Endpoint not found.' }),
  );
  app.use((error: any, req: Request, res: Response, next: NextFunction) => {
    const correlation = res.locals.correlation_id || id();
    if (error instanceof z.ZodError)
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: error.issues[0]?.message || 'Invalid request.',
        field_errors: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        correlation_id: correlation,
      });
    if (error instanceof DomainError && error.status === 429) res.set('Retry-After', '3600');
    if (error instanceof DomainError)
      return res
        .status(error.status)
        .json({ code: error.code, message: error.message, correlation_id: correlation });
    if (error?.code === '23505' || error?.code === '40P01')
      return res.status(409).json({
        code: 'CONFLICT',
        message: 'This action conflicts with another change. Refresh and try again.',
        correlation_id: correlation,
      });
    if (error instanceof SyntaxError)
      return res
        .status(400)
        .json({ code: 'INVALID_JSON', message: 'Request body is not valid JSON.' });
    if (error?.type === 'entity.too.large')
      return res.status(413).json({
        code: 'BODY_TOO_LARGE',
        message: 'The upload or request exceeds the allowed size.',
      });
    console.error(
      JSON.stringify({
        event: 'request_failed',
        correlation_id: correlation,
        code: 'REQUEST_FAILED',
      }),
    );
    return res.status(500).json({
      code: 'REQUEST_FAILED',
      message: 'Something went wrong. Please retry or contact support.',
      correlation_id: correlation,
    });
  });
  return app;
}
