import { test, expect, type Page } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', {
    data: { email: 'collector@pixup.demo', password: 'PixupDemo2026!' },
  });
  expect(response.status()).toBe(200);
  await page.goto('/assistant');
}

test('guide searches actual cards, follows result links and clears its conversation', async ({
  page,
}) => {
  await login(page);
  await expect(page).toHaveTitle('Ask PixUP · PixUP');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  await page.getByRole('button', { name: 'Find sports cards under $100', exact: true }).click();
  const conversation = page.getByRole('log', { name: 'Conversation' });
  await expect(
    conversation.getByText('Full Court · Silver Parallel', { exact: true }),
  ).toBeVisible();
  await expect(conversation.getByText('$58', { exact: true })).toBeVisible();
  const link = conversation.getByRole('link').filter({ hasText: 'Full Court · Silver Parallel' });
  await expect(link).toHaveAttribute('href', '/items/court-03');
  await page.getByRole('button', { name: 'Clear chat', exact: true }).click();
  await expect(conversation.getByText('What would you like to discover?')).toBeVisible();
  await page.getByLabel('Ask a question', { exact: true }).fill('Show sellers with K-pop cards');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(
    conversation.getByRole('link').filter({ hasText: 'Archive House' }).first(),
  ).toBeVisible();
  await conversation.getByRole('link').first().click();
  await expect(page).toHaveURL(/\/items\//);
  await page.getByRole('link', { name: 'Ask PixUP', exact: true }).click();
  await expect(page.getByText('What would you like to discover?')).toBeVisible();
});

test('assistant route preserves the MFA gate without fetching the catalog', async ({ page }) => {
  const catalogRequests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/catalog')) catalogRequests.push(r.url());
  });
  await page.route('**/api/me', async (route) => {
    const response = await route.fetch();
    const session = await response.json();
    if (session.user) session.user.mfa_required = true;
    await route.fulfill({ json: session });
  });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Account security', exact: true })).toBeVisible();
  await expect(page.getByLabel('Ask a question', { exact: true })).toHaveCount(0);
  expect(catalogRequests).toEqual([]);
});

test('guide handles errors and AI opt-in, and is accessible on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/assistant/config', (route) =>
    route.fulfill({ json: { ai_available: true } }),
  );
  const bodies: any[] = [];
  await page.route('**/api/assistant/messages', async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      await route.fulfill({ status: 503, json: { message: 'Please try again.' } });
    } else {
      await route.fulfill({
        json: {
          answer: 'Use Seller studio to start intake.',
          mode: 'ai',
          notice: '',
          results: [
            {
              kind: 'help',
              title: 'Seller studio',
              description: 'Start your intake.',
              href: '/workspace/seller',
            },
          ],
        },
      });
    }
  });
  await login(page);
  const field = page.getByLabel('Ask a question', { exact: true });
  await field.fill('How do I sell a card?');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.assistant-chat').getByRole('alert')).toContainText(
    'Please try again.',
  );
  await expect(field).toHaveValue('How do I sell a card?');
  expect(bodies[0].use_ai).toBe(false);
  await page.getByRole('checkbox', { name: /^Use AI answers/ }).check();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('log').getByRole('link', { name: /Seller studio/ })).toBeVisible();
  expect(bodies[1].use_ai).toBe(true);
  const results = await new AxeBuilder({ page })
    .include('.assistant-layout')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('guests must sign in and account changes clear assistant content', async ({ page }) => {
  await page.goto('/assistant');
  await expect(page.getByRole('heading', { name: 'Your collection starts here.' })).toBeVisible();
  await login(page);
  await page.getByRole('button', { name: 'Find buyers from my sales', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('No buyers matched your sales records');
  await page.context().clearCookies();
  await page.reload();
  await expect(page.getByRole('log')).toHaveCount(0);
});

test('assistant route recovers from a rendering failure with a fresh conversation', async ({
  page,
}) => {
  // Exercise the route boundary with a deliberately malformed API fixture.
  await page.route('**/api/assistant/messages', (route) =>
    route.fulfill({ json: { answer: 'Fixture', mode: 'local', notice: '', results: null } }),
  );
  await login(page);
  await page.getByRole('button', { name: 'Find sports cards under $100', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ask PixUP couldn’t open.' })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('What would you like to discover?');
});
