import { test, expect, type Page } from '@playwright/test';
async function login(page: Page, role: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(`${role}@pixup.demo`);
  await page.getByLabel('Password', { exact: true }).fill('PixupDemo2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
}
test('partial refund contract fixture submits explicit allocations for independent review', async ({
  page,
}) => {
  await login(page, 'ops');
  let body: any;
  await page.route('**/api/ops/payment-controls', (r) =>
    r.fulfill({
      json: {
        adjustments: [],
        disputes: [],
        reconciliations: [],
        events: [],
        refunds: [],
        scopes: [
          { order_id: 'fixture-partial-order', account_id: 'acct_fixture', provider_mode: 'test' },
        ],
      },
    }),
  );
  await page.route('**/api/ops/payments/fixture-partial-order/partial-refund', (r) => {
    body = r.request().postDataJSON();
    return r.fulfill({ json: { id: 'fixture-independent-approval' } });
  });
  await page.goto('/ops');
  await page.getByRole('button', { name: 'Payments', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Payment order', exact: true })
    .selectOption('fixture-partial-order');
  await page.getByText('Request a partial cash refund', { exact: true }).click();
  await page.getByLabel('Seller refund allocation (USD)').fill('1.25');
  await page.getByLabel('Fee refund allocation (USD)').fill('0.25');
  await page
    .getByLabel('Partial refund reason')
    .fill('Explicit synthetic price adjustment for independent review');
  await page.getByRole('button', { name: 'Request partial refund review' }).click();
  await expect(page.getByRole('status')).toContainText(
    'Partial refund sent for independent finance approval',
  );
  expect(body).toEqual({
    seller_cents: 125,
    fee_cents: 25,
    shipping_cents: 0,
    reason: 'Explicit synthetic price adjustment for independent review',
  });
  await expect(page.getByText('Stripe test mode only.', { exact: false })).toBeVisible();
});
test('Connect contract fixture requires consent and provider refresh after hosted return', async ({
  page,
}) => {
  await login(page, 'seller');
  let state = 'none';
  await page.route('**/api/connect', (r) =>
    r.fulfill({
      json: {
        enabled: true,
        countries: ['US'],
        bank_payouts_tracked: false,
        recipient:
          state === 'none'
            ? null
            : {
                id: 'recipient-fixture',
                country: 'US',
                state,
                requirements_count: state === 'ready' ? 0 : 1,
                transfers_active: state === 'ready',
                payouts_enabled: state === 'ready',
              },
      },
    }),
  );
  await page.route('**/api/connect/onboard', (r) => {
    expect(r.request().postDataJSON()).toEqual({ country: 'US', accepted_terms: true });
    state = 'onboarding';
    return r.fulfill({
      json: {
        url: 'https://connect.stripe.com/setup/test-fixture',
        expires_at: Math.floor(Date.now() / 1000) + 300,
      },
    });
  });
  await page.route('https://connect.stripe.com/setup/test-fixture', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<h1>Hosted Connect contract fixture</h1><a href="http://127.0.0.1:3100/account/settings?connect_return=1">Return from onboarding</a>',
    }),
  );
  await page.route('**/api/connect/refresh', (r) => {
    state = 'ready';
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto('/account/settings');
  const start = page.getByRole('button', { name: 'Continue to Stripe test onboarding' });
  await expect(start).toBeDisabled();
  await page.getByLabel('I consent to hosted test seller onboarding for this account.').check();
  await start.click();
  await expect(
    page.getByRole('heading', { name: 'Hosted Connect contract fixture' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Return from onboarding' }).click();
  await expect(page.getByText('Provider readiness: onboarding', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh seller readiness' }).click();
  await expect(page.getByText('Provider readiness: ready', { exact: false })).toBeVisible();
});
