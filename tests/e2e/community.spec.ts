import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { totp } from '../../packages/domain/identity-secrets';
async function login(page: Page, email: string, password = 'PixupDemo2026!') {
  const res = await page.request.post('/api/auth/login', { data: { email, password } });
  expect(res.status()).toBe(200);
  await page.goto('/community');
}
async function setup(page: Page, name: string) {
  await page.goto('/community/settings');
  await page.getByLabel('Community display name').fill(name);
  await page.getByRole('button', { name: 'Save community profile' }).click();
  await expect(page.getByRole('status')).toContainText('Community profile saved');
  if (await page.getByRole('button', { name: 'Accept guidelines' }).count()) {
    await page.getByLabel('I agree to these community guidelines').check();
    await page.getByRole('button', { name: 'Accept guidelines' }).click();
    await expect(page.getByText('Accepted · community-pilot-v1')).toBeVisible();
  }
}
async function moderator(page: Page, name = 'moderator') {
  await login(page, `community-${name}@example.test`, 'Community-browser-2026!');
  await page.goto('/account/security');
  await page.getByLabel('Current password for enrollment').fill('Community-browser-2026!');
  await page.getByRole('button', { name: 'Start authenticator enrollment' }).click();
  const secret = await page.locator('.notice code').innerText();
  await page.getByLabel('Authenticator or recovery code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify authenticator', exact: true }).click();
  await expect(
    page.getByText('Save these recovery codes now. Each can be used once.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'I saved my recovery codes' }).click();
  await page.goto('/ops');
  await page.getByRole('button', { name: 'Community', exact: true }).click();
}
test('member story, review, reply, report and independent appeal work across browser sessions', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  await login(page, 'collector@pixup.demo');
  await setup(page, 'Story collector');
  await page.goto('/community/new');
  await page.getByLabel('Title', { exact: true }).fill('The story behind my first IP card');
  await page.getByLabel('Beginner questions', { exact: true }).check();
  await page
    .getByLabel('Your post', { exact: true })
    .fill('This card reminds me of a favorite event. <script>window.communityXss=true</script>');
  await page.getByRole('button', { name: 'Preview post' }).click();
  await expect(page.locator('.community-body')).toContainText('<script>');
  expect(await page.evaluate(() => Object.hasOwn(window, 'communityXss'))).toBe(false);
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page).toHaveURL(/\/community\/posts\/[^/]+$/);
  const postURL = page.url();
  await expect(page.getByText('Status: pending', { exact: true })).toBeVisible();
  const modContext = await browser.newContext(),
    mod = await modContext.newPage();
  await moderator(mod);
  const story = mod.locator('article').filter({ hasText: 'The story behind my first IP card' });
  await story
    .getByLabel('Reason shown to the author')
    .fill('Reviewed story against our community guidelines.');
  await story.getByRole('button', { name: 'Record decision' }).click();
  await expect(story).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Comments', exact: true })).toBeVisible();
  const readerContext = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    reader = await readerContext.newPage();
  await login(reader, 'seller@pixup.demo');
  await setup(reader, 'Fellow collector');
  await reader.goto(postURL);
  await reader
    .getByLabel('Your comment', { exact: true })
    .fill('Thank you for sharing your first card story.');
  await reader.getByRole('button', { name: 'Submit comment for review' }).click();
  await expect(reader.getByText('Status: pending', { exact: true })).toBeVisible();
  await mod.reload();
  await mod.getByRole('button', { name: 'Community', exact: true }).click();
  const comment = mod
    .locator('article')
    .filter({ hasText: 'Thank you for sharing your first card story.' });
  await comment
    .getByLabel('Reason shown to the author')
    .fill('Reviewed respectful reply about collecting experience.');
  await comment.getByRole('button', { name: 'Record decision' }).click();
  await page.reload();
  await expect(
    page.getByText('Thank you for sharing your first card story.', { exact: true }),
  ).toBeVisible();
  await reader.reload();
  const post = reader
    .locator('article')
    .filter({ has: reader.getByRole('heading', { name: 'The story behind my first IP card' }) });
  await post.getByRole('button', { name: 'Save post', exact: true }).click();
  await post.getByRole('button', { name: 'Report', exact: true }).click();
  await reader
    .getByLabel('What should the moderator know?')
    .fill('Please review the story for a possible privacy concern.');
  await reader.getByRole('button', { name: 'Send report' }).click();
  await expect(reader.getByRole('dialog')).toHaveCount(0);
  await mod.reload();
  await mod.getByRole('button', { name: 'Community', exact: true }).click();
  const reported = mod.locator('article').filter({ hasText: 'The story behind my first IP card' });
  await reported.getByRole('combobox', { name: /^Decision/ }).selectOption('hide');
  await reported
    .getByLabel('Reason shown to the author')
    .fill('Temporarily hidden while reviewing the privacy concern.');
  await reported.getByRole('button', { name: 'Record decision' }).click();
  await page.goto('/community/recovery');
  const hidden = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'hide', exact: true }) });
  await hidden.getByText('Appeal this decision').click();
  await hidden
    .getByLabel('Why should we reconsider?')
    .fill('This story contains only my own collecting experience.');
  await hidden.getByRole('button', { name: 'Submit appeal' }).click();
  await expect(hidden).toContainText('Appeal: open');
  const otherContext = await browser.newContext(),
    other = await otherContext.newPage();
  await moderator(other, 'reviewer');
  const appeal = other
    .locator('article')
    .filter({ hasText: 'This story contains only my own collecting experience.' });
  await appeal.getByLabel('Appeal decision').selectOption('overturn');
  await appeal
    .getByLabel('Appeal reason')
    .fill('Independent review returns the story for publication review.');
  await appeal.getByRole('button', { name: 'Review appeal' }).click();
  await expect(appeal).toHaveCount(0);
  await page.reload();
  await expect(hidden).toContainText('Appeal: overturned');
  await reader.goto('/community/topics');
  const axe = await new AxeBuilder({ page: reader })
    .include('.community')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(axe.violations).toEqual([]);
  expect(
    await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await Promise.all([modContext.close(), readerContext.close(), otherContext.close()]);
});
test('guests see a sign-in introduction without member content', async ({ page }) => {
  await page.goto('/community');
  await expect(page.getByRole('link', { name: 'Sign in to Community' })).toBeVisible();
  expect((await page.request.get('/api/community/posts')).status()).toBe(401);
});
