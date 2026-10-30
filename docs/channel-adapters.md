# Channel adapter pilot

This increment implements the B11/B12 and F5 **local pilot contracts** for CVM, LiveUP, GOUP, WaxUP and read-only Query/Match/Route. It reuses listings, quotes, orders, payments, refunds, credits, settlements, provenance and the journal. It does not activate live payments, a real device, a streaming provider, carrier integration or paid AI billing.

## Start and activate

Run `npm run dev`. Startup applies migration `007-channels.sql`; existing orders retain `channel=web`. The migration adds exclusively held channel allocations, separate physical fulfillment states, device identities/commands/events/returns, sealed stock and pack lineage, participant pledges, business approval, return requests and scoped tool credentials. All five activation gates start **disabled**.

1. Sign in as `ops@pixup.demo` with the existing demo password and open **Workspace → Channel workspace** (`/workspace/channels`).
2. Expand **Pilot activation gates**. Record test evidence and enable CVM and LiveUP. GOUP/WaxUP require both first-phase gates; AI requires all four channel gates. These are local workflow gates, not production approval.
3. Create a channel under an organization where you have an owner/operator/publisher membership. Terms are fixed when created; create a new context for changed terms. A warehouse-scoped operator may manage platform stock and record physical custody. Other publishers may allocate only their own stock.
4. Assign an existing active, vaulted listing by its listing ID and a unique slot/reference. For factory-sealed stock, use **Register sealed physical stock** first and copy its listing ID into the allocation form. Supplier and seal references remain private. A sealed pack has no VIA authenticity claim and cannot be purchased on the ordinary marketplace.
5. Browse `/channels` as a buyer. Channel quotes and checkout use the existing `/quotes`, `/checkouts` and order payment pages. Quotes bind the allocation, channel terms and shipping share. Gated, offline, unavailable or differently allocated stock is rechecked at checkout. An old web quote cannot bypass a new channel allocation.

A paid channel order stays `paid` until its physical fulfillment succeeds. Its `channel_fulfillment.state` explains whether it awaits fulfillment, has an unknown outcome, requires a refund, or is fulfilled/refunded/canceled. The ledger records payment once. A channel does not create a second balance or wallet.

## CVM device protocol and simulator

The API uses a small provider-neutral Ed25519 protocol:

- Each CVM context has one device public key. Register only the public PEM; private device keys stay on the device/simulator. Warehouse staff can revoke a device immediately.
- `POST /v1/devices/{context_id}/events` accepts raw JSON of at most 64 KiB, independently of browser cookies and CSRF. `X-Device-Timestamp` is Unix time in **milliseconds**, within five minutes. `X-Device-Signature` is Base64 Ed25519 over the UTF-8 bytes `context_id + "\n" + timestamp + "\n" + raw_body`.
- Every event includes a unique `event_id`. Reusing an ID with identical bytes replays the stored result; changed bytes conflict. A replayed heartbeat only returns commands that are still issued and unexpired; it never reissues a completed or unknown command. Revocation and signature checks happen before replay.
- Heartbeat: `{ "event_id": "...", "type": "heartbeat" }`. A heartbeat less than 90 seconds old is required for new quotes/checkouts. A heartbeat response contains any newly issued commands.
- A command contains `id`, a **string** `payload` and a Base64 server `signature`. Verify the signature over the payload bytes using the pinned server public key, then verify its device ID, command ID, slot, action and expiry. Payload fields are `command_id`, `device_id`, `order_id`, `slot`, `asset_id`, `action=dispense` and `expires_at`.
- Vend result: `{ "event_id": "...", "type": "vend", "command_id": "...", "outcome": "delivered|not_dispensed|unknown", "evidence": "..." }`. Evidence must have at least 10 characters. A final outcome cannot be replaced.
- Deposit result: `{ "event_id": "...", "type": "deposit", "return_id": "...", "evidence": "..." }`. Buyers first create their return reference in the channel page. A signed deposit acknowledges receipt and grants **zero credits**. Warehouse receipt creates a standard VIA intake; any later RePool admission still uses separate eligibility and consent.

One durable command exists per paid order. The server marks it issued **before** returning it. After 90 seconds without a result, an issued command becomes unknown; it is never replaced with a fresh vend command. Before manual reconciliation, staff must physically isolate the device and wait until the signed command expiry plus the five-minute device clock tolerance. This prevents a delayed but still valid command from dispensing after a refund. Signed device outcomes remain usable immediately; device firmware must persist the terminal outcome before reporting it. A queued command that expires after five minutes without being issued requires refund review. A final `not_dispensed` result permits the existing refund workflow, but the asset remains in device custody and the slot remains held until warehouse staff records physical removal. A successful dispense records delivery and closes the allocation.

To run the simulator:

```sh
npm run cvm:sim -- init /tmp/pixup-device-demo
```

Register `/tmp/pixup-device-demo/device-public.pem` when creating the CVM channel. Copy the **server command public key** shown in the channel workspace to `/tmp/pixup-device-demo/command-public.pem`. Set the device context ID returned by channel creation:

```sh
export CVM_SIM_DIR=/tmp/pixup-device-demo
export CVM_SIM_DEVICE_ID=your-channel-context-id
# Optional; defaults to this local URL.
export CVM_SIM_API_URL=http://127.0.0.1:4000/v1
npm run cvm:sim -- heartbeat
```

Buy/pay through the channel page, wait for the API worker (two-second interval), then run another heartbeat. It simulates a successful dispense. To exercise ambiguity or failure:

```sh
CVM_SIM_OUTCOME=unknown npm run cvm:sim -- heartbeat
CVM_SIM_OUTCOME=not_dispensed npm run cvm:sim -- heartbeat
npm run cvm:sim -- deposit your-return-reference-id
```

The simulator writes and syncs a local journal before actuation, retains pending signed events and deduplicates command replay. A crash during actuation resolves to unknown on restart. Only one process may use a device directory. After a process crash, confirm it is stopped and remove only its stale `simulator.lock`; retain `journal.json`. Deleting/resetting the journal invalidates the duplicate-actuation guarantee. The simulator has no physical actuator.

Set server-only `CVM_COMMAND_PRIVATE_KEY` to a persistent Ed25519 PKCS8 PEM (literal `\n` escapes are supported) before a sustained integration trial. With no setting, the API generates an ephemeral local signing identity: restart changes the public key and old queued commands may require reconciliation. Do not silently re-pin keys to accept old commands. Real hardware needs firmware-level deduplication, trusted device storage, key provisioning/rotation, sensor/serial evidence and fleet procedures.

## LiveUP

Each session allocates a particular physical item or sealed pack. The buyer pays through the common checkout. The paid queue remains allocated across browser/stream interruption. A current session publisher or warehouse operator records the opening with a recording reference, millisecond offset, evidence and exact physical content count. No software draw selects contents.

A sealed-pack reveal creates buyer-owned child registry records, immutable pack-to-item lineage and unverified VIA status. Retrying the same reveal returns the original items; changed reveal data conflicts. Opened packs cannot be relisted or refunded through the original sealed-order shortcut. The buyer order retains the recording reference and links to child passports. The current pilot retains revealed items in the vault; outbound custody selection, streaming delivery, recording retention and trusted physical capture remain provider work.

## GOUP

An organizer creates fixed terms, a future deadline, target participant slots and total shipping in cents. All slots must be stocked before pledging; consented stock cannot change. Shipping is split equally, with remainder cents assigned by stable slot/ID order. Buyers explicitly pledge a slot and may withdraw before lock. Only a fully stocked and pledged group can lock and accept payment; each slot can be purchased only by its participant.

Each participant supplies their own delivery address and pays their own standard order. The organizer has no withdrawal or pooling wallet. Warehouse dispatch is blocked until all participants have paid. Deadline shortfalls or pre-dispatch participant refunds cancel the group and flag paid orders for refund review. Late provider success is still recorded and flagged for recovery. Pending Stripe reservations remain held until provider-confirmed cancellation/expiry; channel cancellation never releases them blindly. Once group dispatch starts, remaining participant refunds require a separate return investigation. Delivery addresses are visible to warehouse staff, not other participants or ordinary organizers.

## WaxUP

Finance approves a buyer against a current operating/publishing organization membership. Revocation or membership loss blocks new purchases. Each order covers one uniquely registered sealed case; its declared unit count must match the channel's units per case. Multiple cases use separate orders. Credits are rejected. Orders carry a stable **demo** invoice reference, USD total, case quantity and fixed return terms.

A buyer may request one conditional return within the snapshotted window measured from payment. A warehouse approval creates a standard physical inspection intake with the requested buyback/consignment mode in its evidence. It creates no buyback payout, pool admission or credit grant. Returned-case commercial disposition, supplier agreements, tax invoices, minimum order quantities and partner remittance remain separate work. A sealed case is not automatically a set of VIA-certified specimens.

## Scoped Query / Match / Route

Create and revoke 30-day credentials in `/workspace/developer`. The secret is displayed once, stored only as a hash on the server and held only in page memory in the interactive tester. Keep integration credentials in your own secret store.

Use `Authorization: Bearer <credential>` with `POST /v1/tools/query`, `/match` or `/route`. Each strict input schema accepts:

```json
{
  "request_id": "unique-request-id",
  "query": "Rookie",
  "category": "Sports",
  "max_price_cents": 20000,
  "limit": 10
}
```

`route` additionally requires `asset_id`. `query` is a literal title search, `match` applies explicit filters and returns the matching reason, and `route` returns an internal review path requiring user confirmation. These are deterministic tools suitable for a later agent integration, not an external LLM service. There are no mutation, payment, shell, browser or credit tools. Request text never becomes executable instructions.

Every call checks the gate, expiry, revocation, authorized scope and credential creator's **current** organization membership. Results contain permission-safe eligible stock, source asset/channel/allocation IDs, price, certification, custody, an evaluation timestamp and a 30-second freshness window. Offline devices, locked stock and ineligible business/group allocations are excluded. No customer identity, address, draft, supplier reference or reviewer evidence is returned.

Successful calls are metered per credential per UTC day. The same request ID/input replays without another usage charge, preserving its original timestamp and freshness window. Changed input under the same ID conflicts; expired/revoked credentials cannot replay. An old replay is an old snapshot, not renewed availability. Route links create no reservation; normal buyer authorization and checkout checks run again. Usage metering is local accounting only, with no subscription billing or approved price-comparison/valuation engine.

## Recovery and verification

Warehouse operators use `/workspace/channels` for unresolved vends, pack openings, physical dispatch and device returns. Finance uses **Operations → Payments** for Stripe test refunds; existing provider idempotency/reconciliation rules apply. Demo buyers can reverse eligible orders from their order page. Held settlements cannot release before channel fulfillment.

Short database transactions acquire shared advisory lock `770077` before changing channel/core stock or payment state. Network calls happen outside transactions. This intentionally serializes pilot mutations across API instances on the same PostgreSQL database; fleet scaling requires measured partitioned locking. PGlite remains a single-process development runtime.

`tests/channels.test.ts`, `tests/device-simulator.test.ts`, the Stripe CVM refund test and `tests/e2e/channels.spec.ts` cover the adapter boundaries. `npm run postgres:recovery-check` requires an **empty disposable** PostgreSQL database via `PIXUP_VERIFY_DATABASE_URL` and checks migrations, backfill, concurrent stock reservations, signed command completion, tool quotas and payment/refund replay. It never loads the application's `.env` database destination.
