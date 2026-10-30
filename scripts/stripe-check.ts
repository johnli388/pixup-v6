import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { StripeCheckoutProvider, checkoutPayload } from '../apps/api/src/stripe';

// This creates temporary cash/credit-only test sessions and expires them immediately.
// No card details, charges, customer records, URLs or credentials are printed.
const provider = new StripeCheckoutProvider(process.env.STRIPE_SECRET_KEY || '');
const reference = randomUUID();
let sessionId: string | undefined;
try {
  for (const cents of [100, 0]) {
    const session = await provider.create(
      checkoutPayload(reference, cents, new Date(Date.now() + 2100000), 'http://127.0.0.1:3000'),
      `pixup-connection-check-${reference}-${cents}`,
    );
    sessionId = session.id;
    const retrieved = await provider.retrieve(sessionId);
    if (retrieved.status !== 'open' || retrieved.amount_total !== cents)
      throw new Error('Unexpected test session state.');
    const expired = await provider.expire(sessionId);
    if (expired.status !== 'expired') throw new Error('Test session did not expire.');
    sessionId = undefined;
  }
  console.log(
    'Stripe test checkout: create, retrieve and expire passed for $1 and credit-only totals. No payment was made.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Stripe connection check failed.');
  process.exitCode = 1;
} finally {
  if (sessionId)
    await provider
      .expire(sessionId)
      .catch(() =>
        console.error('Test session cleanup could not reach Stripe; it will expire automatically.'),
      );
}
