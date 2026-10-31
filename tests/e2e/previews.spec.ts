import { test, expect, type Page } from './fixtures';

async function login(page: Page, user = 'collector') {
  const response = await page.request.post('/api/auth/login', {
    data: { email: `${user}@pixup.demo`, password: 'PixupDemo2026!' },
  });
  expect(response.status()).toBe(200);
}

function observeWrites(page: Page) {
  const writes: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(r.method()))
      writes.push(`${r.method()} ${r.url()}`);
  });
  return writes;
}

test('operations samples disable mutations and can be replaced with live queues', async ({
  page,
}) => {
  await login(page, 'ops');
  await page.route('**/api/ops', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    for (const queue of ['intakes', 'collections', 'orders', 'settlements', 'cases'])
      data[queue] = [];
    await route.fulfill({ json: data });
  });
  const writes = observeWrites(page);
  await page.goto('/ops');
  await expect(page.getByText('Sample operations data', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record receipt', exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Inspect & decide', exact: true }).first(),
  ).toBeDisabled();
  for (const tab of ['Publishing', 'Fulfillment', 'Settlements', 'Support']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    const actions = page.locator('table button, .review-card button');
    expect(await actions.count()).toBeGreaterThan(0);
    for (const action of await actions.all()) await expect(action).toBeDisabled();
  }
  await page.getByRole('button', { name: 'Show live data', exact: true }).click();
  await expect(page.getByText('Live operations data', { exact: true })).toBeVisible();
  await expect(page.locator('table tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show sample data', exact: true }).click();
  await page.getByRole('button', { name: 'Intakes', exact: true }).click();
  await expect(page.getByText('Above the Rim · Rookie Edition', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('community sample filters, topics and stories remain separate from member activity', async ({
  page,
}) => {
  await login(page);
  const writes = observeWrites(page);
  const sampleApiRequests: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/community\/.*(first-courtside-card|first-binder)/.test(r.url()))
      sampleApiRequests.push(r.url());
  });
  await page.goto('/community/samples');
  const preview = page.getByRole('region', { name: 'Sample community' });
  await expect(preview.getByRole('status')).toContainText('8 sample posts');
  await preview.getByLabel('Sample post type').selectOption('story');
  await preview.getByLabel('Search sample posts').fill('brought me back');
  await expect(preview.getByRole('status')).toContainText('1 sample post');
  await preview.getByRole('link', { name: 'The card that brought me back to collecting' }).click();
  await expect(page).toHaveURL(/\/community\/samples\/posts\/first-courtside-card$/);
  await expect(
    preview.getByText('Replies and reactions are read-only in this preview.'),
  ).toBeVisible();
  await expect(preview.getByRole('button')).toHaveCount(0);
  await preview.getByRole('link', { name: 'Explore sample topics', exact: true }).click();
  await expect(preview.locator('article')).toHaveCount(7);
  await preview.getByRole('link', { name: 'Beginner questions', exact: true }).click();
  await expect(page).toHaveURL(/\/community\/samples\/topics\/beginners$/);
  await expect(
    preview.getByRole('heading', { name: 'Beginner questions', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Community', exact: true })
    .getByRole('link', { name: 'My posts', exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  expect(sampleApiRequests).toEqual([]);
  expect(writes).toEqual([]);
});

test('all three California previews have no purchase action or channel API requests', async ({
  page,
}) => {
  const writes = observeWrites(page);
  const sampleApiRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/channels/sample-')) sampleApiRequests.push(r.url());
  });
  await page.goto('/channels');
  const preview = page.getByRole('region', { name: 'California pilot previews' });
  await expect(preview.getByRole('link')).toHaveCount(3);
  const hrefs = await preview
    .getByRole('link')
    .evaluateAll((links) => links.map((a) => a.getAttribute('href')!));
  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.getByText('Fictional pilot location', { exact: true })).toBeVisible();
    await expect(page.getByText('Preview only', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /buy|purchase|checkout|reserve|join/i }),
    ).toHaveCount(0);
    await expect(page.locator('a[href^="/checkout/"]')).toHaveCount(0);
  }
  expect(sampleApiRequests).toEqual([]);
  expect(writes).toEqual([]);
});

test('unsupported URLs return HTTP 404, including extra segments and community routes', async ({
  page,
}) => {
  for (const path of [
    '/not-a-pixup-page',
    '/channels/sample-la-arts-district/extra',
    '/account/orders/id/extra',
    '/community/not-a-feed',
    '/community/samples/posts/id/extra',
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByRole('heading', { name: 'This page wandered off.' })).toBeVisible();
  }
});
