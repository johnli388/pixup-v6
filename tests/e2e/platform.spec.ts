import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';

async function login(page: Page, role = 'collector') {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(`${role}@pixup.demo`);
  await page.getByLabel('Password', { exact: true }).fill('PixupDemo2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
}
async function logout(page: Page) {
  await page.goto('/account/settings');
  await page.getByRole('button', { name: 'Sign out / switch demo account' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test('discover, filter, inspect, save, buy with credits, and refund', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Collect what moves you.' })).toBeVisible();
  await page.goto('/marketplace');
  await page.getByRole('button', { name: 'K-pop', exact: true }).click();
  await expect(page.locator('.item-card')).toHaveCount(3);
  await login(page);
  await page.goto('/items/court-01');
  await page.getByRole('link', { name: 'Make it yours' }).click();
  await page.getByLabel(/Use available credits/).check();
  await page.getByRole('button', { name: 'Review total' }).click();
  await expect(page.locator('.total')).toContainText('$113');
  await page.getByRole('button', { name: 'Confirm demo purchase' }).click();
  await expect(page.getByRole('heading', { name: 'A new chapter, confirmed.' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A new chapter, confirmed.' })).toBeVisible();
  await page.getByRole('button', { name: 'Request vault refund' }).click();
  await page.getByRole('button', { name: 'Confirm refund', exact: true }).click();
  await expect(page.locator('.order-item-large .badge')).toHaveText('refunded');
  await page.goto('/account/credits');
  await expect(page.locator('.credit-card>strong')).toContainText('1,200');
  await page.goto('/marketplace');
  await page
    .getByRole('button', { name: 'Save Above the Rim · Rookie Edition', exact: true })
    .click();
  await page.goto('/account/saved');
  await expect(
    page.getByRole('heading', { name: 'Above the Rim · Rookie Edition', exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('creator draft, independent review, stock intake and publication', async ({ page }) => {
  await login(page, 'creator');
  await page.goto('/workspace/creator');
  await page.getByRole('button', { name: 'New collection', exact: true }).click();
  await page.getByLabel('Collection title').fill('First Light — Browser Edition');
  await page
    .getByLabel('The story behind it')
    .fill('Original first-light studies created for this end-to-end demonstration.');
  await page.getByLabel('Edition size').fill('2');
  await page
    .getByLabel('Rights & ownership evidence')
    .fill(
      'Original artwork produced by Studio Orbit for this demonstration with all rights retained.',
    );
  const artwork = await sharp({
    create: { width: 240, height: 330, channels: 3, background: '#769d83' },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel('Or upload your own artwork')
    .setInputFiles({ name: 'original-artwork.png', mimeType: 'image/png', buffer: artwork });
  await expect(
    page.getByText('Artwork saved privately. Public only after publishing.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  const card = page
    .locator('.creator-collection')
    .filter({ hasText: 'First Light — Browser Edition' });
  await card.getByRole('button', { name: 'Submit for review' }).click();
  await expect(card.locator('.badge')).toHaveText('submitted');
  await logout(page);
  await login(page, 'ops');
  await page.goto('/ops');
  await page.getByRole('button', { name: 'Publishing', exact: true }).click();
  const review = page.locator('.review-card').filter({ hasText: 'First Light — Browser Edition' });
  await review.getByRole('button', { name: 'Review rights submission' }).click();
  await page
    .getByLabel('Evidence & decision notes')
    .fill('Rights evidence reviewed independently and approved for the demo.');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await review.getByRole('button', { name: 'Receive production stock' }).click();
  await page.getByLabel('Specimens physically received').fill('2');
  await page
    .getByLabel('Evidence & decision notes')
    .fill('Two demonstration specimens received, inspected and put away in the vault.');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await logout(page);
  await login(page, 'creator');
  await page.goto('/workspace/creator');
  await card.getByRole('button', { name: 'Set price & publish' }).click();
  await page.getByLabel('Price per collectible (USD)').fill('60');
  await page.getByRole('button', { name: 'Publish collection', exact: true }).click();
  await card.getByRole('link', { name: 'View collection' }).click();
  await expect(page.locator('.item-card')).toHaveCount(2);
  await expect(page.locator('.item-card img').first()).toBeVisible();
});

test('RePool revised offer requires owner consent before credits and title transfer', async ({
  page,
}) => {
  await login(page);
  await page.goto('/workspace/seller');
  await page.getByRole('button', { name: 'Recirculate Orbital No. 02 · Personal Edition' }).click();
  await page
    .getByLabel('Intake evidence & notes')
    .fill('Original demo specimen in continuous vault custody with matching serial.');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request intake', exact: true }).click();
  await page.getByRole('button', { name: /^Intakes/ }).click();
  await expect(page.getByText('awaiting receipt', { exact: true })).toBeVisible();
  await logout(page);
  await login(page, 'ops');
  await page.goto('/ops');
  const row = page.locator('tr').filter({ hasText: 'Orbital No. 02 · Personal Edition' });
  await row.getByRole('button', { name: 'Record receipt' }).click();
  await page
    .getByLabel('Evidence & decision notes')
    .fill('Matching specimen received at the intake workstation.');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await row.getByRole('button', { name: 'Revise offer' }).click();
  await page.getByLabel('Revised demo credits').fill('650');
  await page
    .getByLabel('Evidence & decision notes')
    .fill('Revised demo terms after independent condition inspection.');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await expect(row.getByRole('button', { name: 'Inspect & decide' })).toBeDisabled();
  await logout(page);
  await login(page);
  await page.goto('/workspace/seller');
  await page.getByRole('button', { name: /^Intakes/ }).click();
  await page.getByRole('button', { name: 'Review offer' }).click();
  await expect(page.getByText('Previously accepted: 500 credits (v1).')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept revised offer' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Accept revised offer' }).click();
  await page.goto('/account/credits');
  await expect(page.locator('.credit-card>strong')).toContainText('1,200');
  await logout(page);
  await login(page, 'ops');
  await page.goto('/ops');
  await row.getByRole('button', { name: 'Inspect & decide' }).click();
  await page
    .getByLabel('Evidence & decision notes')
    .fill('Serial and condition verified; accepted for recirculation.');
  await page.getByRole('button', { name: 'Record decision' }).click();
  await expect(row.getByText('accepted', { exact: true })).toBeVisible();
  await logout(page);
  await login(page);
  await page.goto('/account/credits');
  await expect(page.locator('.credit-card>strong')).toContainText('1,850');
});

test('mobile navigation, no horizontal overflow, and public accessibility', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Marketplace NEW' }).click();
  await expect(page.getByRole('heading', { name: 'The marketplace', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
});

test('invitation, viewer workspace and revocation remove stale private access', async ({
  page,
  browser,
}) => {
  await login(page, 'creator');
  await page.goto('/account/settings');
  await page.getByLabel('Invite account email').fill('seller@pixup.demo');
  await page.getByLabel('Workspace role').selectOption('viewer');
  await page.getByRole('button', { name: 'Create invitation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revoke invitation', exact: true })).toBeVisible();
  const member = await browser.newPage();
  try {
    await login(member, 'seller');
    await member.goto('/account/settings');
    await member.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(
      member.getByRole('button', { name: 'Accept invitation', exact: true }),
    ).toHaveCount(0);
    await member.goto('/workspace/creator');
    await expect(member.getByText('Viewer access:', { exact: false })).toBeVisible();
    await expect(
      member.getByRole('button', { name: 'New collection', exact: true }),
    ).toBeDisabled();
    await expect(member.locator('.creator-collection').first()).toBeVisible();
    await page.reload();
    await page
      .locator('.workspace-row')
      .filter({ hasText: 'seller@pixup.demo' })
      .filter({ has: page.getByRole('button', { name: 'Revoke access', exact: true }) })
      .getByRole('button', { name: 'Revoke access', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Revoke access', exact: true })).toHaveCount(0);
    // Focus/refetch handles a tab that was already showing private data.
    await member.bringToFront();
    await expect(member.getByRole('heading', { name: 'Your collection starts here.' })).toBeVisible(
      { timeout: 20000 },
    );
    await expect(member.locator('.creator-collection')).toHaveCount(0);
  } finally {
    await member.close();
  }
});

test('Stripe contract fixture redirects to hosted checkout and waits for server confirmation on return', async ({
  page,
}) => {
  let paid = false,
    orderId = '';
  await page.route('**/api/payments/config', (route) =>
    route.fulfill({
      json: {
        provider: 'stripe_test',
        test_mode: true,
        payment_methods: ['card'],
        webhooks_configured: false,
      },
    }),
  );
  await page.route('**/api/checkouts', async (route) => {
    const response = await route.fetch();
    const order = await response.json();
    orderId = order.id;
    await route.fulfill({ response, json: { ...order, payment_provider: 'stripe_test' } });
  });
  await page.route('**/api/orders/*/stripe-checkout', (route) =>
    route.fulfill({
      json: {
        id: orderId,
        status: 'pending_payment',
        payment_status: 'open',
        url: 'https://checkout.stripe.com/c/pay/cs_test_browser_fixture',
      },
    }),
  );
  await page.route('https://checkout.stripe.com/c/pay/cs_test_browser_fixture', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Hosted checkout fixture</h1>' }),
  );
  await page.route('**/api/orders/*/payment-status', (route) =>
    route.fulfill({
      json: {
        id: orderId,
        status: paid ? 'fulfilled' : 'pending_payment',
        payment_status: paid ? 'succeeded' : 'open',
        url: null,
      },
    }),
  );
  await page.route('**/api/orders/*', async (route) => {
    const response = await route.fetch();
    const order = await response.json();
    await route.fulfill({
      response,
      json: {
        ...order,
        payment_provider: 'stripe_test',
        ...(paid ? { status: 'fulfilled', paid_at: new Date().toISOString() } : {}),
      },
    });
  });
  await login(page);
  await page.goto('/checkout/court-01');
  await page.getByRole('button', { name: 'Review total', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to Stripe Checkout', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Hosted checkout fixture' })).toBeVisible();
  await page.goto(`/account/orders/${orderId}?payment_return=success`);
  await expect(
    page.getByText(
      'Waiting for Stripe confirmation. Returning from checkout alone does not confirm payment.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Complete demo payment' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'A new chapter, confirmed.' })).toHaveCount(0);
  paid = true;
  await expect(page.getByRole('heading', { name: 'A new chapter, confirmed.' })).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole('button', { name: 'Request vault refund' })).toHaveCount(0);
});
