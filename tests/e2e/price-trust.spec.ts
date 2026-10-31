import { test, expect } from './fixtures';
test('finance curates price references and audit exports an unsigned checkpoint without activating money policies', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address').fill('ops@pixup.demo');
  await page.getByLabel('Password', { exact: true }).fill('PixupDemo2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
  const item = await (await page.request.get('/api/assets/orbit-01')).json();
  await page.goto('/ops');
  await page.getByRole('button', { name: 'Pricing', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Price observations', exact: true }),
  ).toBeVisible();
  await page.getByText('Create a comparable cohort', { exact: true }).click();
  await page.getByLabel('Cohort label', { exact: true }).fill('Browser Orbit comparable cohort');
  await page
    .getByLabel('Comparable definition')
    .fill('Equivalent Orbit edition, variant and exact grade; browser fixture only.');
  await page.getByLabel('Exact grade', { exact: true }).fill(item.grade);
  await page.getByLabel('Specimen IDs').fill('orbit-01');
  await page.getByRole('button', { name: 'Create cohort', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Refresh simulation snapshot' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh simulation snapshot' }).click();
  await expect(page.getByText(/simulation · insufficient data/)).toBeVisible();
  await expect(page.getByText(/No reserve deductions, 6Re actions/)).toBeVisible();
  await page.getByRole('button', { name: 'Signatures', exact: true }).click();
  await expect(page.getByText(/Trust store not configured/)).toBeVisible();
  await page.getByLabel('Signing request type').selectOption('checkpoint');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download signing request' }).click();
  expect((await download).suggestedFilename()).toBe('pixup-checkpoint-request.json');
  await page.goto('/items/orbit-01');
  await page.getByRole('button', { name: 'Price reference', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Price methodology' })).toContainText(
    'Browser Orbit comparable cohort',
  );
  await expect(page.getByText(/Simulation trades · insufficient data/)).toBeVisible();
  await page.goto(`/verify/${item.passport.certificate.id}`);
  await expect(page.getByText('Record signature: trust not configured.')).toBeVisible();
});
