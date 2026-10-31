import { test, expect, type Page } from './fixtures';
async function login(page: Page, role: string) {
  test.setTimeout(90000);
  await page.goto('/login');
  await page.getByLabel('Email address').fill(`${role}@pixup.demo`);
  await page.getByLabel('Password', { exact: true }).fill('PixupDemo2026!');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const result = await response;
  if (result.status() === 429) {
    // The complete suite shares one loopback address. Respect the real throttle instead of disabling it.
    const seconds = Number(result.headers()['retry-after']);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
    await page.waitForTimeout(seconds * 1000 + 100);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
}
test('finance drafts explicit subscription terms and cannot approve its own activation', async ({
  page,
}) => {
  await login(page, 'ops');
  await page.goto('/ops');
  await page.getByRole('button', { name: 'Billing', exact: true }).click();
  await page.getByText('Draft a monthly test plan', { exact: true }).click();
  await page.getByLabel('Plan name', { exact: true }).fill('Browser-reviewed monthly plan');
  await page.getByLabel('Recurring USD per month').fill('25');
  await page.getByRole('button', { name: 'Save plan draft' }).click();
  const plan = page.locator('article').filter({ hasText: 'Browser-reviewed monthly plan' });
  await expect(plan).toContainText('$25/month');
  await plan
    .getByLabel('Plan review reason')
    .fill('Review the synthetic monthly plan terms and usage caps');
  await plan.getByRole('button', { name: 'Request activation review' }).click();
  await page.getByRole('button', { name: 'Approvals', exact: true }).click();
  await expect(page.getByText('Another finance reviewer must decide this request.')).toBeVisible();
  expect((await (await page.request.get('/api/billing/plans')).json()).plans).toHaveLength(0);
});
test('workspace inventory records category-specific details and keeps revisions actionable', async ({
  page,
}) => {
  await login(page, 'collector');
  await page.goto('/workspace/seller');
  await page.getByText('Register a workspace item', { exact: true }).click();
  await page.getByLabel('Workspace item name').fill('Browser K-pop inventory record');
  await page
    .getByLabel('Workspace item description')
    .fill('Synthetic declared collectible for the organization inventory workflow');
  await page.getByLabel('Workspace item category').selectOption('K-pop');
  await page.getByLabel('Declared group', { exact: true }).fill('Browser Group');
  await page.getByLabel('Declared member', { exact: true }).fill('Member One');
  await page.getByLabel('Declared album', { exact: true }).fill('Album One');
  await page.getByRole('button', { name: 'Register workspace item', exact: true }).click();
  const item = page.locator('details').filter({
    has: page
      .locator('summary')
      .filter({ hasText: 'Browser K-pop inventory record · seller · unverified' }),
  });
  await item.locator('summary').click();
  await expect(item.getByRole('region', { name: 'Structured catalog details' })).toContainText(
    'Album One',
  );
  await item.getByLabel('Catalog album', { exact: true }).fill('Album Two');
  await item.getByRole('button', { name: 'Save catalog attributes' }).click();
  await expect(item.getByRole('region', { name: 'Structured catalog details' })).toContainText(
    'Album Two',
  );
  await page.goto('/account/settings');
  await expect(page.getByRole('heading', { name: 'Subscription and usage' })).toBeVisible();
  await expect(
    page.getByText('No independently approved paid test plans are published.'),
  ).toBeVisible();
});
test('subscription checkout contract fixture requires recurring consent and provider confirmation on return', async ({
  page,
}) => {
  await login(page, 'collector');
  let state = 'none';
  const plan = {
    id: 'fixture-plan',
    name: 'Approved fixture plan',
    audience: 'demand',
    amount_cents: 2500,
    trial_days: 0,
    grace_days: 3,
    limits: {
      seats: 5,
      asset_registrations: 100,
      collection_drafts: 10,
      listing_creations: 50,
      tool_calls: 500,
    },
  };
  await page.route('**/api/billing/plans', (r) =>
    r.fulfill({ json: { enabled: true, mode: 'stripe_test', plans: [plan] } }),
  );
  await page.route('**/api/billing/accounts/collector-org', (r) =>
    r.fulfill({
      json: {
        org_id: 'collector-org',
        entitlement: {
          plan: state === 'active' ? plan.name : 'Local pilot',
          state: state === 'active' ? 'active' : 'pilot',
          limits: plan.limits,
        },
        usage_window: 'UTC calendar month',
        usage: [],
        subscriptions:
          state === 'none'
            ? []
            : [
                {
                  id: 'sub-fixture',
                  plan_id: plan.id,
                  name: plan.name,
                  state: state === 'active' ? 'active' : 'pending',
                  period_end:
                    state === 'active' ? new Date(Date.now() + 86400000).toISOString() : null,
                },
              ],
        invoices:
          state === 'active'
            ? [{ id: 'in_fixture', status: 'paid', amount_due: 2500, amount_paid: 2500 }]
            : [],
      },
    }),
  );
  await page.route('**/api/billing/accounts/collector-org/checkout', (r) => {
    expect(r.request().postDataJSON()).toEqual({ plan_id: plan.id });
    state = 'pending';
    return r.fulfill({
      json: {
        id: 'sub-fixture',
        state: 'pending',
        checkout_url: 'https://checkout.stripe.com/c/pay/subscription-fixture',
      },
    });
  });
  await page.route('https://checkout.stripe.com/c/pay/subscription-fixture', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<h1>Hosted subscription contract fixture</h1><a href="http://127.0.0.1:3100/account/settings?billing_return=sub-fixture">Return after fixture payment</a>',
    }),
  );
  await page.route('**/api/billing/subscriptions/sub-fixture/refresh', (r) => {
    state = 'active';
    return r.fulfill({ json: { id: 'sub-fixture', state: 'active', checkout_url: null } });
  });
  await page.goto('/account/settings');
  const checkout = page.getByRole('button', { name: 'Continue to test subscription checkout' });
  await expect(checkout).toBeDisabled();
  await page.getByLabel("I agree to this test plan's recurring price and terms.").check();
  await checkout.click();
  await expect(
    page.getByRole('heading', { name: 'Hosted subscription contract fixture' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Return after fixture payment' }).click();
  await expect(page.getByText('Approved fixture plan · active', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'in_fixture', exact: true })).toBeVisible();
});
