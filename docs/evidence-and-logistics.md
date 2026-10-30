# Private evidence and physical handling

Production increment 4 adds private image/PDF upload records, an S3-compatible adapter, ClamAV scanning, independent content review, intake identity capture, local labels, simulated carrier tracking, loss/damage reviews and retention controls. Migration 011 preserves existing media, intakes, orders and assessments. No cloud resources, carrier account, postage, insurance or paid service were provisioned. Application mode remains a local demo.

## Configuration and rollout

The server accepts these settings from its environment; `.env.example` documents them. Existing `.env` values are not changed by this increment.

| Setting                                                                 | Behavior                                                                                                        |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `EVIDENCE_STORAGE=database`                                             | Default local fallback; private evidence bytes are in PostgreSQL                                                |
| `EVIDENCE_STORAGE=s3`                                                   | New private originals and artwork derivatives use S3; also enables managed artwork moderation                   |
| `S3_ENDPOINT`                                                           | HTTPS endpoint origin, with no path, query, credentials or redirects; requests use path-style bucket addressing |
| `S3_BUCKET`, `S3_REGION`                                                | Dedicated private bucket and signing region                                                                     |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, optional `S3_SESSION_TOKEN` | Server-only credentials, supplied through the deployment secret store                                           |
| `CLAMAV_SOCKET`                                                         | Path to a separately provisioned local clamd Unix socket; required for S3 mode                                  |
| `MANAGED_ARTWORK=true`                                                  | Enables quarantine/moderation for new artwork even with database storage                                        |
| `PHYSICAL_CAPTURE_REQUIRED=true`                                        | Requires captures before intake receipt/acceptance and disables the old one-step demo shipment endpoint         |

For an isolated evaluation, provision a private test bucket and an updated clamd instance, configure the server, then restart it. The S3 principal needs object read/write/delete on the dedicated `pixup/` prefix; it does not need public access or bucket administration. Require TLS, block public access, configure encryption and access monitoring, and retain independently controlled backups according to an approved policy. The adapter signs full request payloads and requests AES256 server-side encryption. Its conditional writes verify existing content on replay. Compatibility with a particular S3 implementation must be tested before adoption. [AWS request signing](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html), [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)

Keep clamd's socket private to the API/scanner process and maintain its signature database. The adapter implements bounded INSTREAM framing with a timeout; unavailable, malformed, oversized or error responses leave files quarantined. Only an explicit clean response advances a file. There is no production setting that fabricates a clean verdict. Antivirus does not establish authenticity, rights or content suitability. [ClamAV protocol](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)

Default local artwork retains the existing decode/re-encode workflow for compatibility. Managed mode applies to new uploads; old embedded artwork is not silently migrated or certified as scanned. Evidence documents always require scanning and review, including in database mode. Without a scanner, upload records remain available for recovery but originals cannot be downloaded or approved. Existing text evidence remains historical text.

The seed contains one staff identity. A separate authorized reviewer is necessary when staff upload evidence or capture an item they would otherwise assess. No demo user is automatically promoted. Staff provisioning and verified identity remain increment 2.

## Upload, moderation and access

Settings → **Private evidence** and Operations → **Evidence** provide upload, status, download, review and retention controls. The owner supplies an item ID for intake/shipment/incident evidence or a collection ID for rights documents. Collection access checks current membership; asset evidence checks current ownership or the relevant staff permission. Operators can find item IDs in Physical handling. Artwork can be uploaded independently, approved, then selected by its uploader in the artwork picker.

1. `POST /v1/evidence` reserves an opaque file ID with purpose, scope, size, MIME, SHA-256 and a client retry key. Identity fields are immutable. The same key resumes the same contents; changed metadata is rejected.
2. `POST /v1/evidence/{id}/bytes` accepts matching raw bytes. Uploads are bounded to 10 MB, single-frame images to 24 megapixels, and reservations to 24 hours. Artwork's existing upload endpoint remains bounded to 6 MB. Each account can reserve at most 50 files per day. Interrupted object writes resume the same key and digest.
3. The worker verifies stored bytes, obtains a clean scan, and creates a metadata-stripped WebP derivative for artwork. Scanner failures retry with a cooldown; detected malware remains blocked. A synchronization version prevents older results from replacing newer state. A delayed derivative after purge is removed or retained in a visible purge-retry state.
4. Another scoped staff member reviews content: rights permission for artwork/rights documents, warehouse for intake/shipment evidence, support for incident evidence. Review can reject a clean file, approve it, or withdraw prior approval. Staff cannot approve their own upload. Clean is not the same as approved.
5. Downloads require authenticated scope and a clean pending-review/approved file. They use attachment disposition, no-store, no-sniff and sandbox headers; PDFs are not embedded. Asset ownership transfer does not grant the new owner access to another user's private originals. Public media serving exposes only approved artwork derivatives and rechecks approval after retrieval. Private originals never become public through publication.

Image/PDF detection and malware scanning are not document sanitization, OCR, identity verification, rights validation or automated image moderation. Original evidence retains its original bytes and may contain metadata; use fictional data in the pilot. Do not treat a clean PDF as safe for arbitrary execution. Human moderation decisions and downloads are audited. The API proxies bounded files; direct browser-to-bucket signed uploads, multipart/resumable large files, a CDN and independent worker deployment remain future work.

## Physical intake and identity

Operations → **Physical handling** lists open intakes. A warehouse operator records the observed serial, unique tamper seal, storage bin, approved front/back images, and a capture note. Images must belong to the exact asset and intake purpose. The capture and local `PXI-…` label are immutable. Replaying identical capture inputs returns the same record; changed inputs require discrepancy review.

The observed serial must match the registered serial. A mismatch requires an incident report rather than an override. Label and seal text identify application records; they are not ownership credentials, machine-verified identities or proof of authenticity. The capture UI supports typing/scanner-as-keyboard input; it does not implement camera recognition or a carrier barcode standard.

With `PHYSICAL_CAPTURE_REQUIRED=true`, uncaptured intakes cannot be received or accepted. Every captured intake, even when the global gate is off, requires currently approved photographs and a VIA assessor different from the capture operator. Existing ownership, RePool consent, receipt, refund, and channel gates continue to apply. Captures do not themselves receive stock, issue a certificate, grant credits or transfer title. Production batch intake, cross-warehouse movements, seal replacement and physical standards still need their own versioned operational procedures.

## Shipment labels and tracking

The implemented carrier is explicitly **simulated**, for individual web orders with shipment fulfillment. It does not contact a carrier or purchase a label. GOUP, WaxUP, LiveUP and CVM keep their existing channel workflows.

| Transition   | Required evidence and result                                                                                                                                                |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create label | Paid web shipment, buyer ownership, vault custody, no conflicting holds and approved packing evidence; creates one `DEMO-…` local label, preserving custody and paid status |
| Dispatch     | Matching recorded seal, approved evidence, expected sequence and retry key; moves custody to shipping, keeping order paid                                                   |
| Deliver      | Uninterrupted in-transit state, matching owner/seal and approved evidence with no incident/refund hold; moves custody to delivered and order to fulfilled                   |
| Loss/damage  | Opens an incident and support case, quarantines stock, revokes active certification and blocks settlement                                                                   |
| Return       | Records witnessed return evidence from transit/delivery/exception into quarantine; no automatic refund, title change, credits or payout                                     |

Label creation and dispatch cannot release seller funds. Settlement retains independent finance approval and all existing payout restrictions; tracked shipments additionally require delivery without an exception. Existing demo orders can still use the historical shortcut while the physical gate is disabled, but an order with a tracked shipment cannot bypass it. Print local records from Physical handling; these are **not postage**. Buyer/seller order pages expose only the simulated status timeline and local tracking reference, without private operational evidence or seal/bin details.

Events require warehouse permission and CSRF; there is no unsigned external carrier webhook. Per-shipment expected sequences reject stale events, and retry keys reject changed payloads while replaying identical events once. A real carrier adapter must add durable provider attempts, account scoping, authenticated events, authoritative reconciliation, label void/recovery, address handling, rates, insurance and return-label acceptance before real shipments.

## Loss, damage and identity review

The evidence workspace can open a report using approved item-scoped evidence; current owners or authorized warehouse/support/VIA staff may report. Reports quarantine the item, withdraw active listings, revoke active certification and open a support review. Reserved orders remain subject to the existing payment exception/recovery path. A separate support reviewer resolves the report with an expected version and reason.

Resolution does not restore custody eligibility or certification, release money, compensate a claimant or issue a refund. Tracked lost/damaged stock needs a witnessed return before intake/refund can proceed; circulation needs fresh intake/VIA assessment. The existing finance/payment paths remain responsible for money. Lost-in-transit insurance claims, disposal, partial refunds, compensation, real returns and legal liability rules remain unresolved production work. A case that cannot satisfy the return/assessment gates remains held for manual policy review.

## Retention, recovery and monitoring

Each upload has a **provisional local 30-day minimum**, not an approved jurisdictional retention policy. The database prevents shortening it. Audit staff can record a legal hold or release it with a reason. Purge requires expired retention, no hold, no reference from captures/shipments/events/incidents/artwork, and no active related intake/payment/incident. Collection rights evidence requires separate retention review. No scheduler automatically deletes evidence.

Purge first records durable intent, then deletes external objects outside the business transaction and clears local bytes only after success. Retry a `purging` record after storage recovers. Metadata, hashes and audit history remain. On versioned or retention-locked storage, deleting the current object does not erase older versions, replicas or backups; those need the separately approved provider retention process. The application hold is not S3 Object Lock or protection against a privileged database administrator.

Database backups include embedded evidence. **They do not include S3 object bytes.** For external storage, retain/restore the matching bucket objects and credentials configuration independently, reconcile immutable keys/hashes with `stored_files`, verify artwork hashes against `media`, and test private retrieval before reopening traffic. Switching storage settings affects new uploads only; database originals remain readable and S3 records require their original bucket configuration. No bulk migration or rewrite of existing evidence is performed.

Monitoring adds `evidence_scan` for failed/overdue scans and `physical_incident` for open exceptions. Scanning runs on a separate local timer so network/scanner latency does not stall reservation expiry or payment recovery. Restore scanner availability, refresh file status, then perform independent review; do not edit database verdicts to clear a backlog. Privacy export includes the uploader's evidence metadata; retained files prevent automated account closure until retention review.

## Validation and remaining production acceptance

Backend checks exercise lost writes, byte tampering, scan errors/malware, independent moderation/takedown, scope changes, capture identity/assessor independence, event ordering/replay, exception holds and interrupted/racing purge. S3 signing/conditional writes use a deterministic transport fixture; clamd framing uses a local Unix-socket protocol fixture. PostgreSQL checks migration 011 and real bytea/evidence/incident transactions. Browser journeys cover a real private upload that remains quarantined and a simulated shipment UI contract fixture.

No real S3 upload, installed ClamAV malware corpus, carrier shipment, postage purchase or immutable off-host evidence restore was exercised. Complete those integration checks, independent content/security review, approved capture/handling/retention standards and provider recovery drills before external operation. This increment implements the local foundation of item 4; it does not grant production launch approval. See [implementation status](implementation-status.md) and [operational readiness](operational-readiness.md).
