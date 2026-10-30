# Operational readiness and recovery

Production increment 7 adds local privacy controls, security monitoring and repeatable PostgreSQL recovery/load exercises. Read the [security assessment](security-assessment.md) and [implementation status](implementation-status.md) before using this outside local evaluation.

## Account privacy and age

`PILOT_MINIMUM_AGE=18` is the user-approved local default; only integer values 18–99 are accepted. Account settings provides the declaration, separate optional marketing choice, account-data download and restriction/deletion/age-review requests. The declaration is self-attestation without identity documents or birth dates. New buying, listing, publishing, RePool admission, channel participation, artwork upload and tool use require current eligibility. Existing recovery, refunds, vault returns and support continue.

Operations → Privacy requires `support`; reviewers cannot decide their own requests. Record a decision reason. `restore_access` requires a new declaration; it does not immediately authorize commerce. A `RETENTION_REVIEW_REQUIRED` response leaves deletion pending. Investigate ownership/custody, outstanding credits, business history and organizational dependencies; never delete journals or provenance to bypass it. The 30-day request deadline is an internal alert target, not a jurisdictional compliance claim. Restriction also disables marketing, and restricted accounts cannot opt back in.

Migration 008 is additive. Existing users without declarations are gated at the next commercial action, while existing orders continue recovery. Back up a database before migrating it; tests and drills use disposable databases and have not migrated the user's `.data/pixup` directory.

## Monitoring and incident response

- `/v1/health` is process liveness; `/v1/ready` returns 503 when a bounded database check fails or the core worker has not succeeded within 30 seconds.
- Operations → Monitoring requires `audit`. It displays readiness, request counters/timings, recent durable security/error events and alerts. Acknowledgement records an actor and reason; it does not clear a condition. Resolved conditions clear automatically; recurrence requires a new acknowledgement.
- `/v1/metrics` accepts an audit-scoped session or `Authorization: Bearer` with `MONITORING_TOKEN` of at least 32 characters. Provision a random secret via the runtime secret store, rotate it there and in the scraper, and never put it in source or command output. Metrics are operational data, not a public endpoint.
- `TELEMETRY_LOGS=true` emits allowlisted JSON HTTP records. Correlation IDs connect responses to events. Raw URLs, queries, request bodies, addresses, cookies, authorization headers, provider payloads and SQL/errors are excluded. Persisted security/error events expire after 30 days; expired sessions and old account-throttle records are also cleaned up. External log retention is separate.

The worker records aggregate success every two seconds; alert evaluation runs every 15 seconds. Signals include outbox age over five minutes, overdue payment reviews/refunds, unknown device outcomes, overdue privacy requests, elevated rejected requests, repeated server errors, invalid journals/credits and stale workers. There are bounded in-memory metrics/event queues; counters reset on restart and `pixup_telemetry_dropped_total` reports overflow. Authentication throttling is shared through PostgreSQL; IP limits are per process and currently see the Next proxy as a shared peer. Configure trusted edge identity and distributed abuse controls before scaling.

Use [the example scraper](../infra/monitoring/prometheus.example.yml) and [alert rules](../infra/monitoring/alerts.yml) as deployment inputs. Mount the token file, configure TLS and an independently hosted Prometheus/Alertmanager with an approved receiver. No receiver has been configured and no messages have been sent. Prove receiver delivery with a controlled staging outage; the API's own evaluator cannot page anyone after the API dies.

For a critical alert, acknowledge with the investigation reference, correlate the sanitized event, and inspect the relevant Payments, channel recovery or Privacy queue. Preserve ambiguous payment/physical-stock holds. Use existing reconciliation/refund/recovery workflows rather than modifying journals or marking a provider outcome manually. For a stalled worker, check database access and individual worker error codes before restarting; then verify heartbeat, outbox progress and alert resolution. Never post credentials or raw customer records in an incident note.

## Encrypted backup and restore

The implementation follows PostgreSQL's [consistent snapshot and custom archive facilities](https://www.postgresql.org/docs/current/app-pgdump.html). It requires a PostgreSQL server and compatible `pg_dump`/`pg_restore`; it does not dump the embedded PGlite directory. `PIXUP_PG_BIN` defaults to `/opt/homebrew/opt/postgresql@18/bin`; set it to the installed client directory elsewhere. Use clients compatible with the server, and an explicit TLS-enabled database connection outside loopback.

Provision these environment values without printing them: `PIXUP_BACKUP_DATABASE_URL`, a base64 encoding of exactly 32 random bytes in `PIXUP_BACKUP_KEY`, and a **different, empty** target in `PIXUP_RESTORE_DATABASE_URL`. These scripts never load `.env`. Store the key separately from the archive; losing it loses the backup.

```sh
npm run db:backup -- /secure-backups/pixup-snapshot.pxb
npm run db:restore -- /secure-backups/pixup-snapshot.pxb
```

The destination directory must already exist. Backup refuses to overwrite either artifact. It streams a custom PostgreSQL dump through AES-256-GCM and writes a restricted-permission manifest, taking fingerprints and integrity checks from the same exported repeatable-read snapshot. Both files and the containing directory are synced. Keep the `.pxb` and `.pxb.manifest.json` together; protect both as sensitive operational material. The manifest checksum detects file mismatch; GCM authenticates the archive.

Restore refuses existing non-system database objects. It authenticates the full archive into a private temporary directory before invoking `pg_restore --single-transaction`, then compares all table counts/fingerprints and verifies journal balance, credit bounds, unique live stock and complete provenance hashes. Temporary plaintext is removed after the attempt. Allocate protected disk space for the decrypted archive and use only trusted backups. PostgreSQL globals/roles, application secrets, software, external stores and infrastructure configuration are **not** included. If a post-restore check fails, isolate that disposable target and investigate; no automatic production cutover occurs.

Deploy scheduled off-host backups, restricted key access, retention and storage lifecycle separately. Rehearse restoration into replacement infrastructure and measure a business-approved RPO/RTO, including data since the snapshot, key retrieval, infrastructure provisioning and service verification. `restore_ms` measures only the local restore/check stage; `snapshot_age_seconds` is not a measured production RPO. A database restore is also a privacy event: replay restrictions/closure requests recorded after the snapshot before reopening access, using a separately retained request register. Never use an older restored copy to silently undo a deletion request.

## Repeatable load and restore exercise

Provide **two distinct empty disposable PostgreSQL databases** in `PIXUP_VERIFY_DATABASE_URL` and `PIXUP_VERIFY_RESTORE_URL`, then run:

```sh
PIXUP_LOAD_SECONDS=60 PIXUP_LOAD_RPS=10 npm run ops:verify
```

On macOS with the default Homebrew PostgreSQL tools, this helper provisions both databases and stops the temporary server afterward:

```sh
PIXUP_LOAD_SECONDS=60 PIXUP_LOAD_RPS=10 python3 scripts/with-disposable-postgres.py
```

`PIXUP_LOAD_SECONDS` accepts 5–300 (default 20), `PIXUP_LOAD_RPS` accepts 1–100 (default 20), and `PIXUP_LOAD_CONCURRENCY` accepts 1–100 (default 8). The local fail thresholds are zero unexpected responses or rejected arrivals, mixed-request p95 below `PIXUP_LOAD_P95_MS` (default 750), scarce-checkout p99 below five seconds and restore/check time below 60 seconds. IP rate limits still apply; exceeding them intentionally fails a capacity run. A single proxy/IP is not representative of all production clients.

The exercise creates synthetic consenting users and artwork, drives authenticated catalog/item/credit/order/quote requests, and issues 100 simultaneous checkouts for one physical specimen. Exactly one must win. A fake provider adds 200 ms latency; concurrent confirmation must produce one payment journal. Workers run concurrently; lock waiters and event-loop delay are measured. It then checks integrity, generates an outbox alert, backs up, proves wrong-key restore leaves an empty target, restores all tables, rejects reuse of the nonempty target and replays notifications twice with one delivery. Alert resolution is checked after recovery. No real payment or customer data is used.

The temporary output directory contains `report.json` and an encrypted exercise archive. The random exercise key is intentionally not retained, so that archive is not a reusable backup. Preserve the sanitized report as evidence, not the ephemeral artifact path. The [October 30 evidence](evidence/item7-local-readiness-2026-10-30.json) records a 60-second, 10 RPS run: 594 mixed requests, p95 7 ms, zero unexpected statuses/dropped arrivals, one winner/99 conflicts, 55 restored tables and one post-restore notification. These are small local-fixture measurements, not production capacity estimates.

## Release checks

`npm run security:audit` checks production dependency advisories and exits nonzero for findings **or unavailable results**. Set `PIXUP_SECURITY_REPORT` to retain its JSON report. The October 30 local attempt was unavailable; a successful assessment and remediation remain required. Review build dependencies separately as part of the independent supply-chain assessment.

The [readiness workflow](../.github/workflows/readiness.yml) runs backend/browser/build checks, dependency assessment and a PostgreSQL restore/load drill. Hosted CI execution and external monitor delivery have not been verified here. Before paid launch, retain independent security-review findings/remediation, an available advisory scan, approved privacy/age/retention policy, deployed alert delivery evidence, off-host restore evidence and a representative sustained-load report. Local results do not override the eight production increments or enable live commerce.
