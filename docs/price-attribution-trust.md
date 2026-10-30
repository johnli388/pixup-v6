# Price observations, attribution and certificate integrity

Production increment 6 now has executable local workflows for comparable price observations, creator attribution and independent signing/checkpoint artifacts. Migration 009 is additive and does not backfill market prices, signatures, key trust or commercial approvals. All internal commerce remains simulation, including Stripe test transactions.

## Comparable price methodology

Operations → Pricing requires `finance`. Create an explicitly curated cohort with its equivalent variant/edition/language definition, exact condition grade and specimen IDs. Category or collection membership alone is not enough to establish comparability. Only specimens matching the grade can be assigned. Cohort definitions and assignments are immutable in this increment: review them carefully; exclude misclassified observations and use a separately reviewed migration if a specimen mapping needs correction. The definition is public; private source evidence belongs in the observation evidence fields.

Price observations have two separate lanes:

- **Simulation:** snapshot creation captures paid PixUP demo/Stripe-test orders once, with the original order reference. Capture does not create additional orders or financial events. Pending/canceled outcomes, refunds (including unresolved refund attempts), credit consideration, shared-organization/self-dealing trades, changed grades and revoked authenticity eligibility cannot establish a price. Shared membership is a conservative affiliation signal, not comprehensive wash-trade detection.
- **External:** finance records a permitted source, unique source sale reference, permission and comparability/finality evidence, item-only USD amount and completed-at time. Another finance reviewer must include it. Nonfinal or related-party rows cannot be included. No scraper, licensed data feed or verified real-sales dataset is supplied; reviewers are responsible for evidence. External records never create PixUP orders, GMV, ownership, credit, journal entries or payables.

`pulserate-pilot-v1` computes a median and linearly interpolated 25th/75th percentiles from eligible observations in the preceding 90 days. It requires at least five observations, including three within 30 days. An interquartile range greater than the median withholds the reference as dispersed. All eligible outliers remain in the sample; the robust estimator does not silently delete them. Results are integer USD cents with cohort, method, as-of time, counts, exclusion reasons and **provisional** confidence. The range is a middle-50% observation range, not a confidence interval.

Refresh each lane explicitly to publish an append-only snapshot containing the exact input IDs, amounts, times, exclusion decisions and result. Review corrections append a new decision; never overwrite a raw sale. Public reads recheck current outcomes, review decisions, grade and observation age. Changed inputs or a snapshot older than one day withhold its amount until refresh. Old snapshots remain available to finance for reproduction. No-data/stale/dispersed states return `null`, not zero or a fallback asking price. Private source references, order IDs and evidence are omitted from the public report. The legacy `pricing` field remains a raw demo-observation compatibility view; the UI uses `price_reference`.

```sh
npm run pricing:calibrate
PIXUP_CALIBRATION_REPORT=/tmp/price-calibration.json npm run pricing:calibrate
```

The [retained calibration report](evidence/item6-synthetic-calibration-2026-10-30.json) checks six deterministic synthetic scenarios: a stable cohort, an extreme contaminant, sparse data, stale data, incompatible dispersion and expired observations. Known synthetic medians have zero error in the two available-reference scenarios. This validates the implementation and provisional thresholds; it does **not** establish market accuracy, representative sample sufficiency or empirical uncertainty coverage. Before a market launch, acquire permitted completed-sale observations, define audited variant mappings/quality labels, hold out item/batch/time groups, backtest bias/error and coverage by cohort, and approve a new methodology version with evidence. Do not silently retune v1 or mix simulation into that dataset.

## Creator attribution

Creator workspace → Creator attribution uses `ifci-observations-pilot-v1`, scoped by current organization membership. It separates recorded order activity from qualifying current paid/fulfilled unrelated-party transactions without pending/successful refunds. Pending, canceled, refunded or related-party activity remains visible as excluded. The source is the collection's issuing organization; this is an observation rule, not proof of a beneficiary agreement. Current membership changes may conservatively change affiliation exclusions.

Reports use transaction counts and an as-of time. They do not manufacture an IFCI score, a 50/50 allocation, royalties or earnings. Agency circulation is recorded but marked excluded from prospective IFCI distribution; other modes say contract and policy required. Every row has `payment_eligible=false` and `payable_cents=null`. External price observations do not count as creator circulation. Creator reports do not expose buyer identity or source permission evidence.

## Independent certificate signing

Operations → Signatures requires `audit`. The API never generates, loads or accepts these private signing keys. A separate key custodian holds Ed25519 PKCS8 private keys outside the API runtime and `.env`, reviews requests offline and returns small signature artifacts. The assessment reviewer cannot request or import a signature for their own assessment, even if they also hold audit permission. A signature attests to the recorded assessment contents; it does not establish physical authenticity, custody, rights or title.

The default seed has one staff account, which also reviewed the seeded assessments. A separately provisioned finance reviewer/audit operator is therefore required for independent price review and certificate requests. This increment does not promote ordinary demo users or add staff-permission administration. Provision separate staff identities and permission rows through controlled deployment administration; the administration UI remains part of increment 2. Tests supply separate temporary actors explicitly.

An independently administered deployment file supplies public trust roots through `CERT_TRUST_STORE`. Start from [the empty example](../infra/trust/public-keys.example.json). An empty/missing configuration leaves records explicitly unsigned/untrusted. Populate it only with approved public keys, using this shape (replace the illustrative PEM placeholder):

```json
{
  "keys": [
    {
      "id": "assessment-key-1",
      "purpose": "certificate",
      "public_key": "-----BEGIN PUBLIC KEY-----\n<SPKI public key>\n-----END PUBLIC KEY-----\n",
      "not_before": "2026-10-30T00:00:00.000Z",
      "not_after": "2027-10-30T00:00:00.000Z",
      "revoked": false
    }
  ]
}
```

Use a separate key and `purpose: "checkpoint"` for the independent checkpoint custodian. IDs are unique; dates and Ed25519 key types are validated. The API reads the public file on each verification/import, so revocation takes effect without process restart. Protect it with deployment ownership distinct from API writers, mount read-only, and independently distribute/pin its approved fingerprints. Application roles cannot edit it. The repository does not provision organizational independence, an HSM or a managed signer for you.

1. Another audit operator exports a certificate request from Operations. The payload binds the certificate/asset/assessment IDs, serial, result, grade, assessment/issuance times and evidence hash; raw reviewer evidence and owner identity are omitted. It includes a request ID, issuance time, format version and simulation marker.
2. The key custodian verifies the record against independently available assessment/evidence, inspects the downloaded request and signs it on the separate machine. Set `PIXUP_SIGNING_KEY_FILE` to the private key path and `PIXUP_SIGNING_KEY_ID` to its public trust-store ID, then run:

   ```sh
   npm run trust:sign -- request.json signature.json
   ```

3. Import **only** `signature.json` in Operations. The strict artifact contains request ID, key ID and base64 signature. The server verifies the pinned key's purpose/validity/revocation, domain-separated canonical bytes, seven-day request expiry and unchanged/current certificate status. Replay of the same artifact is idempotent; conflicting content fails. Private-key fields are rejected.

The public verification screen separates active assessment status from signature trust and checkpoint coverage. An old valid signature never reactivates a revoked/superseded certificate. Key revocation invalidates signature trust while preserving immutable history; it does not mutate the assessment. Expiry prevents new imports; prior signatures remain verifiable for issuance within the key's validity window unless revoked. Rotate by adding a new ID, retaining retired public keys for history, and selecting the new key for fresh requests. On compromise, mark the old key revoked, investigate affected records and obtain fresh independently reviewed signatures. Never delete signed history to hide an incident.

The encoding is the repository's versioned `PIXUP-TRUST-V1` protocol: recursively key-sorted JSON, prefixed with `PIXUP-TRUST-V1\n`, signed with Ed25519. It is not a claim of C2PA, RFC canonicalization conformance or an external timestamp authority. The offline script never loads `.env`, and output files are written with restrictive permissions and no overwrite.

## Independent provenance checkpoints

A checkpoint request first verifies the stored provenance chains and financial/stock invariants, then builds a deterministic SHA-256 Merkle tree over sorted `(asset_id, sequence, hash)` heads. Leaves and inner nodes have separate domain prefixes; an odd node duplicates its sibling. The payload binds the root/count, monotonic checkpoint sequence, previous signed payload digest and server-issued time. Requests are bounded to 10,000 heads in this pilot. This is a snapshot of history, not a trusted wall-clock timestamp.

The offline checkpoint signer additionally requires `PIXUP_CHECKPOINT_ARCHIVE_DIR`, an existing protected directory **outside API control**. It archives the full reviewed request and signature as a sequence-numbered file before releasing the signature artifact, syncs the file/directory, requires the previous archived digest for subsequent checkpoints, and refuses a different request at an existing sequence. Exact replay can recover an artifact after interruption. This makes a conflicting request detectable at the independent custodian as well as during server import. Keep the archive across key rotations; do not start a fresh directory to bypass a conflict.

Server import serializes checkpoint advancement; concurrent requests for the same next sequence cannot both commit. The certificate endpoint exposes only that specimen's Merkle inclusion proof, signed checkpoint payload and whether the head is still current. It does not expose all private asset heads. `verifyProof` and `signatureValid` in `packages/domain/trust.ts` allow independent verification against separately pinned public keys. The latest checkpoint is not replaced with an older “good” one when its key is revoked.

Back up the protected archive independently and compare its highest accepted sequence/root after database restore to detect rollback. A checkpoint whose import failed must be reconciled with the archived artifact; never invent a competing root at its sequence. Production still needs managed key custody, independently administered immutable retention, cadence/lag monitoring, rollback alarms and documented custodian recovery. A local filesystem archive is not WORM storage or a public transparency service. Full requests contain private registry identifiers: restrict their access and publish only approved roots/proofs.

## Governance and verification

The finance screen explicitly reports **policy not configured**. No 6Re action, FPCR reserve movement/deduction, IFCI payment or VACV balance is implemented or activated by these reports. Policy definitions, consent/title authority, finance approval, funding source and reserve reversal treatment remain prerequisites. The existing test fee is not FPCR.

The new regression coverage exercises separate observation lanes, independent finance review, source deduplication, refunds/credit/affiliation exclusions, immutable historical snapshots, robust/sparse/stale results, scoped attribution, certificate purpose/key revocation, offline signing, tampering, inactive certificates, independent archive fork rejection, checkpoint races/proofs and HTTP permission/CSRF validation. The browser workflow creates a cohort/snapshot, exports a checkpoint and checks public price/trust labels. PostgreSQL verification includes migration 009, price review/snapshot JSON round trips and stable canonical checkpoint payloads. Tests generate temporary keys; no real trust root or private signing key is installed by this increment.
