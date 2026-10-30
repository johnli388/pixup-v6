import 'dotenv/config';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { StripeCheckoutProvider, checkoutPayload } from '../apps/api/src/stripe';

// Operator-driven hosted UI acceptance. Never reads/migrates the application database.
// No browser automation or raw card/API-key logging; only Stripe test credentials are accepted.
const [command, file, original] = process.argv.slice(2);
if (!['create', 'verify', 'bind'].includes(command) || !file)
  throw new Error(
    'Usage: npm run stripe:hosted-check -- create|verify|bind /absolute/path/probe.json [original_cs_test_id]',
  );
const path = resolve(file),
  provider = new StripeCheckoutProvider(
    process.env.STRIPE_SECRET_KEY || '',
    process.env.STRIPE_ACCOUNT_ID,
  );
const schema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  account_id: z.string().startsWith('acct_'),
  created_at: z.string().datetime(),
  origin: z.string().url(),
  session_id: z.string().startsWith('cs_test_').nullable(),
  refund_id: z.string().startsWith('re_').optional(),
  refund_requested_at: z.string().datetime().optional(),
  result: z
    .object({
      hosted_complete: z.literal(true),
      refunded_cents: z.literal(100),
      verified_at: z.string(),
    })
    .optional(),
});
type Probe = z.infer<typeof schema>;
async function save(p: Probe) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(p, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(tmp, path);
}
try {
  const account = await provider.identity();
  let probe: Probe;
  try {
    probe = schema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (e) {
    if (command !== 'create' || (e as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error(
        'Probe file is unavailable or invalid; keep the original record for recovery.',
      );
    const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3000',
      url = new URL(origin);
    if (
      url.origin !== origin ||
      url.username ||
      url.password ||
      !['http:', 'https:'].includes(url.protocol)
    )
      throw new Error('APP_ORIGIN must be an HTTP(S) origin.');
    probe = {
      version: 1,
      id: randomUUID(),
      account_id: account,
      created_at: new Date().toISOString(),
      origin,
      session_id: null,
    };
    await writeFile(path, JSON.stringify(probe, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  }
  if (probe.account_id !== account)
    throw new Error('Restore the original Stripe account for this probe.');
  const validate = (session: Awaited<ReturnType<typeof provider.retrieve>>) => {
    if (
      session.metadata.order_id !== probe.id ||
      session.client_reference_id !== probe.id ||
      session.amount_total !== 100 ||
      session.currency !== 'usd' ||
      (probe.session_id && probe.session_id !== session.id)
    )
      throw new Error('Provider session does not match the original $1 test probe.');
  };
  if (command === 'bind') {
    if (!original?.startsWith('cs_test_'))
      throw new Error('Supply the original test Checkout Session ID.');
    const session = await provider.retrieve(original);
    validate(session);
    probe.session_id = session.id;
    await save(probe);
    console.log('Original test session verified and bound.');
  } else if (command === 'create') {
    if (!probe.session_id && Date.parse(probe.created_at) < Date.now() - 23 * 3600000)
      throw new Error(
        'Old ambiguous probe: bind its original session; do not create another charge.',
      );
    const session = probe.session_id
      ? await provider.retrieve(probe.session_id)
      : await provider.create(
          checkoutPayload(
            probe.id,
            100,
            new Date(Date.parse(probe.created_at) + 35 * 60000),
            probe.origin,
          ),
          `pixup-hosted-probe-${probe.id}`,
        );
    validate(session);
    probe.session_id = session.id;
    await save(probe);
    if (session.status !== 'open' || !session.url)
      throw new Error(
        'Session is no longer open. Verify a completed probe or preserve an expired record and start a separate probe.',
      );
    if (new URL(session.url).origin !== 'https://checkout.stripe.com')
      throw new Error('Unexpected hosted checkout destination.');
    console.log(
      'Open this Stripe TEST checkout in your browser and use Stripe test payment details:',
    );
    console.log(session.url);
    console.log(
      'After completing it, run verify with the same probe file. Verification returns the $1 test payment.',
    );
  } else {
    if (!probe.session_id) throw new Error('Create or bind the original hosted session first.');
    const session = await provider.retrieve(probe.session_id);
    validate(session);
    if (
      session.status !== 'complete' ||
      session.payment_status !== 'paid' ||
      !session.payment_intent
    )
      throw new Error(
        'Hosted payment is not complete. Finish the original test checkout in a browser.',
      );
    const snapshot = await provider.payment(session.payment_intent),
      originalRefund = snapshot.refunds.find(
        (r) =>
          r.metadata.refund_id === probe.id && r.amount === 100 && r.metadata.order_id === probe.id,
      );
    if (snapshot.refunds.some((r) => r.id !== originalRefund?.id))
      throw new Error('Unexpected refund history. Review this probe in the test dashboard.');
    if (
      !originalRefund &&
      !probe.refund_id &&
      probe.refund_requested_at &&
      Date.parse(probe.refund_requested_at) < Date.now() - 23 * 3600000
    )
      throw new Error('Old ambiguous refund requires provider review; no replacement was created.');
    if (!probe.refund_requested_at) {
      probe.refund_requested_at = new Date().toISOString();
      await save(probe);
    }
    const refund =
      originalRefund ||
      (probe.refund_id
        ? await provider.retrieveRefund(probe.refund_id)
        : await provider.refund(
            {
              payment_intent: session.payment_intent,
              amount: '100',
              'metadata[order_id]': probe.id,
              'metadata[refund_id]': probe.id,
            },
            `pixup-hosted-refund-${probe.id}`,
          ));
    probe.refund_id = refund.id;
    await save(probe);
    const confirmed = await provider.retrieveRefund(refund.id);
    if (
      confirmed.status !== 'succeeded' ||
      confirmed.amount !== 100 ||
      confirmed.payment_intent !== session.payment_intent ||
      confirmed.metadata.refund_id !== probe.id
    )
      throw new Error(
        'Test refund remains unresolved. Keep this probe file and inspect Stripe test records.',
      );
    probe.result = {
      hosted_complete: true,
      refunded_cents: 100,
      verified_at: new Date().toISOString(),
    };
    await save(probe);
    console.log(
      'Hosted test completion and $1 refund verified. Evidence saved; no application order or real money was used.',
    );
  }
} catch (e) {
  console.error(
    e instanceof Error && e.name !== 'ZodError'
      ? e.message
      : 'Stripe hosted acceptance failed; preserve the probe file and inspect the test dashboard.',
  );
  process.exitCode = 1;
}
