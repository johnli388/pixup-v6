import { test, expect, type Page } from './fixtures';
async function api(page: Page, path: string, body: unknown) {
  const me = await (await page.request.get('/api/me')).json();
  return page.request.post('/api' + path, {
    headers: me.user ? { 'X-CSRF-Token': me.user.csrf } : {},
    data: body,
  });
}
test('adult declaration, data export and restriction are actionable in account settings', async ({
  page,
}) => {
  const email = `privacy-${Date.now()}@example.test`;
  const response = await api(page, '/auth/register', {
    name: 'Privacy browser participant',
    email,
    password: 'Privacy-browser-2026!',
  });
  expect(response.status()).toBe(200);
  await page.goto('/account/settings');
  await expect(
    page.getByText('Review the pilot notice and declaration before buying, listing or publishing.'),
  ).toBeVisible();
  await page.getByLabel('I am at least 18 years old.').check();
  await page.getByLabel(/I have reviewed and accept the local pilot terms/).check();
  await page.getByRole('button', { name: 'Save pilot declaration' }).click();
  await expect(
    page.getByText('Your current declaration permits new pilot transactions.'),
  ).toBeVisible();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download account data' }).click();
  expect((await downloaded).suggestedFilename()).toBe('pixup-account-data.json');
  await page
    .getByLabel('Request details (no identity documents)')
    .fill('Pause future commerce while I review my account');
  await page.getByRole('button', { name: 'Submit privacy request' }).click();
  await expect(
    page.getByText(
      'New commercial activity is restricted. Existing orders, refunds and support remain available.',
    ),
  ).toBeVisible();
  const quote = await api(page, '/quotes', {
    listing_id: 'listing-orbit-01',
    fulfillment: 'vault',
  });
  expect(quote.status()).toBe(403);
  expect((await quote.json()).code).toBe('ACCOUNT_RESTRICTED');
  await page.getByRole('button', { name: 'Sign out / switch demo account' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Email address').fill('ops@pixup.demo');
  await page.getByLabel('Password', { exact: true }).fill('PixupDemo2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
  await page.goto('/ops');
  await page.getByRole('button', { name: 'Privacy', exact: true }).click();
  await expect(page.getByText('Pause future commerce while I review my account')).toBeVisible();
  await page.getByRole('button', { name: 'Monitoring', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operational health' })).toBeVisible();
});
test('browser policy uses fresh script nonces and blocks injected inline script', async ({
  page,
}) => {
  await page.route('**/marketplace', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: (await response.text()).replace(
        '</body>',
        '<script>window.__cspInjected = true</script></body>',
      ),
    });
  });
  const response = await page.goto('/marketplace'),
    first = response!.headers()['content-security-policy'];
  expect(first).toContain("object-src 'none'");
  expect(first).toContain('nonce-');
  expect(
    await page.evaluate(() => (window as unknown as { __cspInjected?: boolean }).__cspInjected),
  ).not.toBe(true);
  const next = await page.reload();
  expect(next!.headers()['content-security-policy']).not.toBe(first);
  await expect(page.getByRole('heading', { name: 'The marketplace' })).toBeVisible();
});
