import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { one, type Database } from '../../../packages/database/index';
import { audit, check, id } from '../../../packages/domain/core';
import { requireStaff, type Actor } from './auth';
const buckets = [50, 100, 250, 500, 1000, 2000, 5000];
type Metric = { count: number; errors: number; sum: number; buckets: number[] };
type Event = {
  id: string;
  correlation_id: string;
  kind: string;
  route: string;
  method: string;
  status: number;
  duration_ms: number;
};
export class MonitoringService {
  private metrics = new Map<string, Metric>();
  private events: Event[] = [];
  private dropped = 0;
  private limits = new Map<string, { count: number; reset: number }>();
  lastSuccess = 0;
  lastFailure = 0;
  constructor(
    private db: Database,
    private logger: (record: object) => void = () => {},
  ) {}
  middleware = (req: Request, res: Response, next: NextFunction) => {
    const start = performance.now();
    res.set({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    res.on('finish', () => {
      // Never log a raw URL, query, body, cookie, IP, authorization, exception or provider payload.
      const route = typeof req.route?.path === 'string' ? req.route.path : 'unmatched',
        method = ['GET', 'POST', 'HEAD', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER';
      const label = `${method} ${route}`,
        ms = Math.max(0, Math.round(performance.now() - start));
      const k = this.metrics.has(label) || this.metrics.size < 200 ? label : 'OTHER unmatched';
      const m = this.metrics.get(k) || {
        count: 0,
        errors: 0,
        sum: 0,
        buckets: buckets.map(() => 0),
      };
      m.count++;
      m.errors += res.statusCode >= 500 ? 1 : 0;
      m.sum += ms;
      buckets.forEach((b, i) => {
        if (ms <= b) m.buckets[i]++;
      });
      this.metrics.set(k, m);
      const event = {
        id: id(),
        correlation_id: res.locals.correlation_id || id(),
        kind:
          res.statusCode >= 500
            ? 'server_error'
            : res.statusCode >= 400
              ? 'request_rejected'
              : route.includes('/auth/')
                ? 'authentication'
                : 'request',
        route,
        method,
        status: res.statusCode,
        duration_ms: ms,
      };
      if (event.kind !== 'request') {
        if (this.events.length < 5000) this.events.push(event);
        else this.dropped++;
      }
      try {
        this.logger({ event: 'http', ...event });
      } catch {
        this.dropped++;
      }
    });
    // Apply before body parsing and signed endpoints; proxy identity must be configured at deployment.
    const family =
      ['/v1/auth/login', '/v1/auth/register'].includes(req.path) ||
      (req.method === 'POST' && req.path.startsWith('/v1/identity/'))
        ? 'auth'
        : req.path.startsWith('/v1/devices/')
          ? 'device'
          : ['/v1/webhooks/stripe', '/v1/webhooks/billing'].includes(req.path)
            ? 'webhook'
            : 'api';
    const now = Date.now(),
      key = `${req.ip}:${family}`;
    let limit = this.limits.get(key);
    if (!limit || limit.reset <= now) {
      if (this.limits.size >= 10000)
        for (const [k, v] of this.limits) if (v.reset <= now) this.limits.delete(k);
      if (!this.limits.has(key) && this.limits.size >= 10000) {
        res.set('Retry-After', '60');
        res
          .status(429)
          .json({ code: 'RATE_LIMIT', message: 'Request capacity reached. Retry shortly.' });
        return;
      }
      limit = { count: 0, reset: now + 60000 };
      this.limits.set(key, limit);
    }
    if (++limit.count > (family === 'auth' ? 30 : family === 'webhook' ? 600 : 1000)) {
      res.set('Retry-After', String(Math.ceil((limit.reset - now) / 1000)));
      res
        .status(429)
        .json({ code: 'RATE_LIMIT', message: 'Too many requests. Try again in a minute.' });
      return;
    }
    next();
  };
  authorize(actor: Actor | null, authorization: string) {
    const expected = process.env.MONITORING_TOKEN,
      actual = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (
      expected &&
      expected.length >= 32 &&
      Buffer.byteLength(actual) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(actual), Buffer.from(expected))
    )
      return;
    check(actor, 'AUTH_REQUIRED', 'Monitoring authentication is required.', 401);
    requireStaff(actor, 'audit');
  }
  async ready() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const worker = await Promise.race([
        one(
          this.db,
          "SELECT (SELECT last_success FROM operational_heartbeats WHERE name='core') AS last_success",
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('database timeout')), 1500);
        }),
      ]);
      const ok =
        !!worker?.last_success && Date.now() - new Date(worker.last_success).getTime() < 30000;
      return { ok, database: 'available', worker: ok ? 'current' : 'stale' };
    } catch {
      return { ok: false, database: 'unavailable', worker: 'unknown' };
    } finally {
      clearTimeout(timer);
    }
  }
  async flush() {
    const batch = this.events.splice(0, 500);
    try {
      if (batch.length)
        await this.db.query(
          `INSERT INTO operational_events(id,correlation_id,kind,route,method,status,duration_ms)
    SELECT id,correlation_id,kind,route,method,status,duration_ms FROM jsonb_to_recordset($1::jsonb) AS x(id text,correlation_id text,kind text,route text,method text,status int,duration_ms int) ON CONFLICT DO NOTHING`,
          [JSON.stringify(batch)],
        );
    } catch {
      this.events.unshift(...batch);
      if (this.events.length > 5000) {
        this.dropped += this.events.length - 5000;
        this.events.length = 5000;
      }
      throw new Error('Monitoring event persistence unavailable');
    }
  }
  async heartbeat(success: boolean) {
    if (success) this.lastSuccess = Date.now();
    else this.lastFailure = Date.now();
    await this.db.query(
      `INSERT INTO operational_heartbeats(name,last_success,last_failure) VALUES ('core',CASE WHEN $1 THEN now() ELSE NULL END,CASE WHEN $1 THEN NULL ELSE now() END)
   ON CONFLICT(name) DO UPDATE SET last_success=CASE WHEN $1 THEN now() ELSE operational_heartbeats.last_success END,last_failure=CASE WHEN $1 THEN operational_heartbeats.last_failure ELSE now() END`,
      [success],
    );
  }
  async evaluate() {
    await this.flush();
    const signals = (
      await this.db
        .query(`SELECT 'outbox_backlog' AS code,'warning' AS severity,'Notification outbox older than five minutes' AS summary,EXISTS(SELECT 1 FROM outbox WHERE processed_at IS NULL AND created_at<now()-interval '5 minutes') AS active
   UNION ALL SELECT 'payment_review','critical','Overdue payment review or stale refund',EXISTS(SELECT 1 FROM payment_reviews WHERE status='open' AND due_at<now()) OR EXISTS(SELECT 1 FROM payment_refunds WHERE status IN ('created','pending','requires_action','requires_review') AND created_at<now()-interval '1 hour')
   UNION ALL SELECT 'device_unknown','critical','Unresolved physical device outcome',EXISTS(SELECT 1 FROM device_commands WHERE state='unknown')
   UNION ALL SELECT 'privacy_overdue','warning','Privacy request exceeded internal review target',EXISTS(SELECT 1 FROM privacy_requests WHERE status='open' AND due_at<now())
   UNION ALL SELECT 'security_rejections','warning','Elevated request rejection rate',(SELECT count(*)>=20 FROM operational_events WHERE status IN (401,403,429) AND created_at>now()-interval '5 minutes')
   UNION ALL SELECT 'server_errors','critical','Repeated server failures',(SELECT count(*)>=5 FROM operational_events WHERE status>=500 AND created_at>now()-interval '5 minutes')
   UNION ALL SELECT 'journal_imbalance','critical','Journal or credit invariant failed',EXISTS(SELECT 1 FROM journal_lines GROUP BY entry_id HAVING sum(amount)<>0) OR EXISTS(SELECT 1 FROM credit_lots WHERE available<0 OR held<0 OR available+held>issued)
   UNION ALL SELECT 'worker_stale','critical','Core worker heartbeat is stale',NOT EXISTS(SELECT 1 FROM operational_heartbeats WHERE name='core' AND last_success>now()-interval '30 seconds')
   UNION ALL SELECT 'billing_review','warning','Subscription provider review or billing event backlog',EXISTS(SELECT 1 FROM subscriptions WHERE error_code IS NOT NULL AND created_at<now()-interval '5 minutes') OR EXISTS(SELECT 1 FROM billing_events WHERE processed_at IS NULL AND created_at<now()-interval '5 minutes')
   UNION ALL SELECT 'evidence_scan','warning','Evidence scanning failed or is overdue',EXISTS(SELECT 1 FROM stored_files WHERE state='scan_failed' OR (state='pending_scan' AND created_at<now()-interval '5 minutes'))
   UNION ALL SELECT 'physical_incident','critical','Unresolved physical loss, damage or identity exception',EXISTS(SELECT 1 FROM physical_incidents WHERE state='open')
   UNION ALL SELECT 'identity_delivery','warning','Identity email delivery is awaiting recovery',EXISTS(SELECT 1 FROM identity_mail WHERE state='pending' AND error_code IS NOT NULL AND created_at<now()-interval '5 minutes')
   UNION ALL SELECT 'provider_reconciliation','critical','Provider dispute, reconciliation discrepancy or ambiguous transfer',EXISTS(SELECT 1 FROM provider_disputes WHERE status NOT IN ('won','warning_closed')) OR EXISTS(SELECT 1 FROM payment_exceptions WHERE state='open') OR EXISTS(SELECT 1 FROM settlement_transfers WHERE state='requires_review' OR error_code IS NOT NULL)
   UNION ALL SELECT 'payment_control_backlog','warning','Refund event, partial refund or recipient needs review',EXISTS(SELECT 1 FROM payment_control_events WHERE processed_at IS NULL AND created_at<now()-interval '5 minutes') OR EXISTS(SELECT 1 FROM payment_adjustments WHERE error_code IS NOT NULL) OR EXISTS(SELECT 1 FROM connect_recipients WHERE error_code IS NOT NULL)`)
    ).rows;
    await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(770078)');
      for (const s of signals) {
        if (s.active)
          await tx.query(
            `INSERT INTO operational_alerts(code,severity,summary,status) VALUES ($1,$2,$3,'active')
     ON CONFLICT(code) DO UPDATE SET status='active',last_seen=now(),resolved_at=NULL,
     acknowledged_by=CASE WHEN operational_alerts.status='resolved' THEN NULL ELSE operational_alerts.acknowledged_by END,
     acknowledged_at=CASE WHEN operational_alerts.status='resolved' THEN NULL ELSE operational_alerts.acknowledged_at END,
     acknowledgement=CASE WHEN operational_alerts.status='resolved' THEN '' ELSE operational_alerts.acknowledgement END`,
            [s.code, s.severity, s.summary],
          );
        else
          await tx.query(
            "UPDATE operational_alerts SET status='resolved',resolved_at=now() WHERE code=$1 AND status='active'",
            [s.code],
          );
      }
      await tx.query("DELETE FROM operational_events WHERE created_at<now()-interval '30 days'");
      await tx.query("DELETE FROM auth_attempts WHERE window_started<now()-interval '1 day'");
      await tx.query('DELETE FROM sessions WHERE expires_at<now()');
    });
  }
  async dashboard(actor: Actor) {
    requireStaff(actor, 'audit');
    return {
      readiness: await this.ready(),
      metrics: this.snapshot(),
      dropped_events: this.dropped,
      alerts: (
        await this.db.query('SELECT * FROM operational_alerts ORDER BY status,first_seen DESC')
      ).rows,
      events: (
        await this.db.query('SELECT * FROM operational_events ORDER BY created_at DESC LIMIT 100')
      ).rows,
    };
  }
  snapshot() {
    return [...this.metrics].map(([route, m]) => ({ route, ...m }));
  }
  async acknowledge(actor: Actor, code: string, note: string) {
    requireStaff(actor, 'audit');
    return this.db.transaction(async (tx) => {
      const alert = await one(
        tx,
        "SELECT code FROM operational_alerts WHERE code=$1 AND status='active' FOR UPDATE",
        [code],
      );
      check(alert, 'NOT_FOUND', 'Active alert not found.', 404);
      await tx.query(
        'UPDATE operational_alerts SET acknowledged_by=$2,acknowledgement=$3,acknowledged_at=now() WHERE code=$1',
        [code, actor.id, note],
      );
      await audit(tx, actor.id, 'operations.alert_acknowledged', code, { note });
      return { ok: true };
    });
  }
  async prometheus() {
    const lines = [
      '# TYPE pixup_http_requests_total counter',
      '# TYPE pixup_http_duration_seconds histogram',
    ];
    for (const [label, m] of this.metrics) {
      const route = JSON.stringify(label);
      lines.push(
        `pixup_http_requests_total{route=${route}} ${m.count}`,
        `pixup_http_errors_total{route=${route}} ${m.errors}`,
      );
      buckets.forEach((b, i) =>
        lines.push(
          `pixup_http_duration_seconds_bucket{route=${route},le="${b / 1000}"} ${m.buckets[i]}`,
        ),
      );
      lines.push(
        `pixup_http_duration_seconds_bucket{route=${route},le="+Inf"} ${m.count}`,
        `pixup_http_duration_seconds_count{route=${route}} ${m.count}`,
        `pixup_http_duration_seconds_sum{route=${route}} ${m.sum / 1000}`,
      );
    }
    const hb = await one(
      this.db,
      "SELECT extract(epoch FROM last_success)::float AS success FROM operational_heartbeats WHERE name='core'",
    );
    lines.push(
      `pixup_worker_last_success_seconds ${hb?.success || 0}`,
      `pixup_telemetry_dropped_total ${this.dropped}`,
    );
    for (const a of (await this.db.query('SELECT code,severity,status FROM operational_alerts'))
      .rows)
      lines.push(
        `pixup_alert_active{code=${JSON.stringify(a.code)},severity=${JSON.stringify(a.severity)}} ${a.status === 'active' ? 1 : 0}`,
      );
    return lines.join('\n') + '\n';
  }
}
