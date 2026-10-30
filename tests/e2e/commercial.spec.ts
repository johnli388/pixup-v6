import { test, expect } from '@playwright/test';

test('finance records a commercial proposal without self-approval or production activation', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/login');
  await page.getByLabel('Email address').fill('ops@pixup.demo');
  await page.getByLabel('Password', { exact: true }).fill('PixupDemo2026!');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const result = await response;
  if (result.status() === 429) {
    const seconds = Number(result.headers()['retry-after']);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
    await page.waitForTimeout(seconds * 1000 + 100);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
  await page.goto('/ops');
  await page.getByRole('button', { name: 'Commercial', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Commercial decisions' })).toBeVisible();
  const registry = page.getByRole('table').filter({ hasText: 'Owners / planning references' });
  await expect(registry.getByRole('row')).toHaveCount(8);
  await page.getByText('Local pilot terms · version 1', { exact: true }).click();
  await expect(
    page.getByText('Minimum age: 18+. Production launch is not approved.'),
  ).toBeVisible();
  await page.getByText('Propose a pilot decision', { exact: true }).click();
  await page.getByLabel('Pilot action').selectOption('disable_credits');
  await page
    .getByLabel('Decision statement')
    .fill('Browser proposal to pause local pilot credit redemption pending review.');
  await page
    .getByLabel('Evidence reference')
    .fill('Synthetic browser review memo, no production authority.');
  await page.getByRole('button', { name: 'Submit commercial proposal' }).click();
  const proposal = page
    .locator('article')
    .filter({ hasText: 'Browser proposal to pause local pilot credit redemption pending review.' });
  await expect(proposal).toContainText('pending');
  await expect(proposal).toContainText(
    'Another finance reviewer must decide this commercial proposal.',
  );
  await expect(proposal.getByRole('button', { name: 'Approve local pilot decision' })).toHaveCount(
    0,
  );
  const data = await (await page.request.get('/api/ops/commercial')).json();
  expect(data.policy.version).toBe(1);
  expect(data.policy.credit_scope).toBe('pixup_owned');
  expect(data.policy.production_launch_approved).toBe(false);
});
