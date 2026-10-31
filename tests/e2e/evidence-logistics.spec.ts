import { test, expect, type Page } from './fixtures';
async function login(page: Page, role: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(`${role}@pixup.demo`);
  await page.getByLabel('Password', { exact: true }).fill('PixupDemo2026!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3100/');
}
test('private document upload is resumable and stays quarantined without a scanner', async ({
  page,
}) => {
  await login(page, 'collector');
  await page.goto('/account/settings');
  await page.getByLabel('Evidence purpose').selectOption('intake');
  await page.getByLabel('Item ID', { exact: true }).fill('owned-01');
  await page.getByLabel('Evidence file').setInputFiles({
    name: 'synthetic-intake.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7\nBrowser synthetic evidence\n%%EOF'),
  });
  await page.getByRole('button', { name: 'Upload private evidence', exact: true }).click();
  await expect(
    page.getByText(/saved\. Malware scanning and independent review are required/),
  ).toBeVisible();
  const list = await (await page.request.get('/api/evidence')).json();
  const file = list.files.find(
    (f: any) => f.purpose === 'intake' && f.asset_id === 'owned-01' && f.mime === 'application/pdf',
  );
  expect(file).toBeTruthy();
  expect(['pending_scan', 'scan_failed']).toContain(file.state);
  const detail = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: file.id }) });
  await detail.locator('summary').click();
  await expect(detail.getByRole('link', { name: 'Download private original' })).toHaveCount(0);
  expect((await page.request.get(`/api/evidence/${file.id}/download`)).status()).toBe(423);
  await page.getByRole('button', { name: 'Upload private evidence', exact: true }).click();
  await expect(
    page.getByText(/saved\. Malware scanning and independent review are required/),
  ).toBeVisible();
  const after = await (await page.request.get('/api/evidence')).json();
  expect(
    after.files.filter((f: any) => f.hash === file.hash && f.purpose === 'intake'),
  ).toHaveLength(1);
});
test('physical operations contract fixture keeps labels distinct from delivered tracking', async ({
  page,
}) => {
  await login(page, 'ops');
  let state = 'label_created',
    sequence = 0;
  const submitted: any[] = [];
  await page.route('**/api/ops/logistics', (route) =>
    route.fulfill({
      json: {
        intakes: [],
        orders: [],
        incidents: [],
        shipments: [
          {
            id: 'fixture-shipment',
            order_id: 'fixture-order',
            asset_id: 'fixture-item',
            title: 'Shipment fixture collectible',
            label_code: 'DEMO-FIXTURE-LABEL',
            seal: 'SEAL-FIXTURE',
            state,
            sequence,
          },
        ],
      },
    }),
  );
  await page.route('**/api/evidence', (route) =>
    route.fulfill({
      json: {
        files: [
          {
            id: 'fixture-evidence',
            asset_id: 'fixture-item',
            purpose: 'shipment',
            state: 'approved',
            mime: 'image/png',
          },
        ],
      },
    }),
  );
  await page.route('**/api/ops/shipments/fixture-shipment/events', async (route) => {
    const d = route.request().postDataJSON();
    submitted.push(d);
    expect(d.expected_sequence).toBe(sequence);
    expect(d.seal).toBe('SEAL-FIXTURE');
    sequence++;
    state = d.kind === 'dispatched' ? 'in_transit' : 'delivered';
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto('/ops');
  await page.getByRole('button', { name: 'Physical handling', exact: true }).click();
  const sh = page
    .locator('details')
    .filter({ has: page.locator('summary').filter({ hasText: 'Shipment fixture collectible' }) });
  await sh.locator('summary').click();
  await expect(sh).toContainText('SIMULATED CARRIER · NOT POSTAGE');
  await expect(sh.locator('summary')).toContainText('label created');
  await sh.getByLabel('Confirm package seal').fill('SEAL-FIXTURE');
  await sh.getByLabel('Event evidence').selectOption('fixture-evidence');
  await sh
    .getByLabel('Handoff or exception note')
    .fill('Synthetic witnessed sealed package handoff');
  await sh.getByRole('button', { name: 'Record simulated event' }).click();
  await expect(sh.locator('summary')).toContainText('in transit');
  await sh.getByLabel('Simulated carrier event').selectOption('delivered');
  await sh.getByLabel('Confirm package seal').fill('SEAL-FIXTURE');
  await sh.getByLabel('Event evidence').selectOption('fixture-evidence');
  await sh
    .getByLabel('Handoff or exception note')
    .fill('Synthetic delivery evidence matched to sealed package');
  await sh.getByRole('button', { name: 'Record simulated event' }).click();
  await expect(sh.locator('summary')).toContainText('delivered');
  expect(submitted.map((d) => d.kind)).toEqual(['dispatched', 'delivered']);
});
