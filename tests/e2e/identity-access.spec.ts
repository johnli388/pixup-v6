import { test, expect } from '@playwright/test';
import { totp } from '../../packages/domain/identity-secrets';
test('authenticator enrollment, one-time recovery and session revocation use real local account APIs', async ({
  page,
}) => {
  const email = `identity-${Date.now()}@example.test`,
    password = 'Browser-identity-2026!';
  const registration = await page.request.post('/api/auth/register', {
    data: { name: 'Identity browser user', email, password },
  });
  expect(registration.status()).toBe(200);
  await page.goto('/account/security');
  await page.getByLabel('Current password for enrollment').fill(password);
  await page.getByRole('button', { name: 'Start authenticator enrollment' }).click();
  const secret = await page.locator('.notice code').innerText();
  await page.getByLabel('Authenticator or recovery code').fill(totp(secret));
  await page.getByRole('button', { name: 'Verify authenticator', exact: true }).click();
  await expect(
    page.getByText('Save these recovery codes now. Each can be used once.'),
  ).toBeVisible();
  const codes = (await page.locator('.notice pre').innerText()).split('\n');
  expect(codes).toHaveLength(10);
  await page.getByRole('button', { name: 'I saved my recovery codes' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(
    page.getByText('Complete authenticator verification to continue.', { exact: false }),
  ).toBeVisible();
  const me = (await (await page.request.get('/api/me')).json()).user;
  expect(
    (
      await page.request.post('/api/quotes', {
        headers: { 'X-CSRF-Token': me.csrf },
        data: { listing_id: 'listing-orbit-01', fulfillment: 'vault' },
      })
    ).status(),
  ).toBe(403);
  await page.getByLabel('Authenticator or recovery code').fill(codes[0]);
  await page.getByRole('button', { name: 'Verify authenticator', exact: true }).click();
  await expect(
    page.getByText('Complete authenticator verification to continue.', { exact: false }),
  ).toHaveCount(0);
  await page.getByLabel('Authenticator or recovery code').fill(codes[0]);
  await page.getByRole('button', { name: 'Verify authenticator', exact: true }).click();
  await expect(page.getByText('Code invalid or already used.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'End other sessions' }).click();
  await expect(page.getByRole('status')).toContainText('Other sessions ended.');
});
test('email-action contract keeps the bearer token in the fragment and requires explicit consumption', async ({
  page,
}) => {
  const token = 'a'.repeat(64);
  let consumed: any;
  await page.route('**/api/identity/consume', (route) => {
    consumed = route.request().postDataJSON();
    return route.fulfill({ json: { ok: true, kind: 'reset', invitation_id: null } });
  });
  await page.goto(`/identity/action#token=${token}`);
  await expect(page).toHaveURL(/\/identity\/action$/);
  await page.getByLabel('This is a password recovery link').check();
  await page.getByLabel('New password', { exact: true }).fill('Browser-reset-private-2026!');
  expect(consumed).toBeUndefined();
  await page.getByRole('button', { name: 'Use email link' }).click();
  await expect(page).toHaveURL(/\/login\?password_reset=1$/);
  await expect(page.getByRole('status')).toContainText('Password changed.');
  expect(consumed).toEqual({ token, password: 'Browser-reset-private-2026!' });
});
