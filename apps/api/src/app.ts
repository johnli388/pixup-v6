import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Database } from '../../../packages/database/index';
import { DomainError, id } from '../../../packages/domain/core';
import { AuthService, requireUser, type Actor } from './auth';
import { CatalogService } from './catalog';
import { CommerceService } from './commerce';
import { OperationsService } from './operations';
import { MediaService } from './media';
import { PaymentService, type PaymentOptions } from './payments';
import { OrganizationService } from './organizations';
import {
  invitationSchema,
  organizationMembersSchema,
  repoolTermsSchema,
  repoolOfferSchema,
  paymentConfigurationSchema,
  paymentStatusSchema,
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
  .object({ title: text(3, 120), description: text(10, 2000), category, artwork })
  .strict();
const listing = z
  .object({ asset_id: text(), price_cents: z.number().int().min(100).max(10000000) })
  .strict();
const quote = z
  .object({
    listing_id: text(),
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
  ) {
    this.organizations = new OrganizationService(db);
    this.auth = new AuthService(db);
    this.catalog = new CatalogService(db);
    this.commerce = new CommerceService(db, paymentOptions.provider ? 'stripe_test' : 'demo');
    this.payments = new PaymentService(db, this.commerce, paymentOptions);
    this.operations = new OperationsService(db);
    this.media = new MediaService(db);
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
  // Stripe signs raw bytes; mount before JSON parsing and cookie/CSRF middleware.
  app.post(
    '/v1/webhooks/stripe',
    express.raw({ type: 'application/json', limit: '256kb' }),
    async (req, res, next) => {
      try {
        res.json(await s.payments.webhook(req.body, req.get('Stripe-Signature') || ''));
      } catch (error) {
        next(error);
      }
    },
  );
  app.use(express.json({ limit: '64kb' }));
  app.use(express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '6mb' }));
  const limits = new Map<string, { count: number; reset: number }>();
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.set({
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      });
      const key = `${req.ip}:${req.path.startsWith('/v1/auth') ? 'auth' : 'api'}`,
        now = Date.now();
      let rate = limits.get(key);
      if (!rate || rate.reset < now) {
        rate = { count: 0, reset: now + 60000 };
        limits.set(key, rate);
      }
      if (++rate.count > (key.endsWith(':auth') ? 30 : 1000))
        return res
          .status(429)
          .json({ code: 'RATE_LIMIT', message: 'Too many requests. Try again in a minute.' });
      if (limits.size > 10000) for (const [k, v] of limits) if (v.reset < now) limits.delete(k);
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
          !(req.path === '/v1/uploads' && req.is(['image/png', 'image/jpeg', 'image/webp']))
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
      next();
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
        res.json(result);
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
  route('post', '/ops/settlements/:id/release', (r) =>
    s.operations.releaseSettlement(user(r), param(r)),
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
    console.error('Request failed', correlation, error);
    return res.status(500).json({
      code: 'REQUEST_FAILED',
      message: 'Something went wrong. Please retry or contact support.',
      correlation_id: correlation,
    });
  });
  return app;
}
