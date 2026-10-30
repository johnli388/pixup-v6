import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto';
async function login(page: Page, role: string) {
  const r = await page.request.post('/api/auth/login', {
    data: { email: `${role}@pixup.demo`, password: 'PixupDemo2026!' },
  });
  // Existing cookies require CSRF on a login too; clear them before switching roles.
  expect(r.status()).toBe(200);
  await page.goto('/');
}
async function switchUser(page: Page, role: string) {
  await page.context().clearCookies();
  await login(page, role);
}
async function post(page: Page, path: string, data: unknown = {}) {
  const me = await (await page.request.get('/api/me')).json();
  const response = await page.request.post('/api' + path, {
    headers: { 'X-CSRF-Token': me.user.csrf },
    data,
  });
  const result = await response.json();
  expect(response.status(), JSON.stringify(result)).toBe(200);
  return result;
}
async function setup(page: Page) {
  await switchUser(page, 'ops');
  for (const kind of ['cvm', 'liveup', 'goup', 'waxup', 'ai'])
    await post(page, `/ops/channels/gates/${kind}`, {
      enabled: true,
      evidence: 'Browser contract pilot fixtures verified',
    });
}
async function pack(page: Page, title: string, units = 1) {
  return post(page, '/ops/channels/packs', {
    title,
    units,
    category: 'Sports',
    price_cents: 2000,
    supplier_reference: 'Private physical supplier receipt',
    seal_reference: randomUUID(),
  });
}

test('LiveUP browser purchase, witnessed reveal, scoped tool credential and buyer lineage', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup(page);
  const c = await post(page, '/channels', {
      kind: 'liveup',
      org_id: 'ops-org',
      name: 'Browser physical pack opening',
      terms: { description: 'Physical pack opening with a witnessed recording' },
    }),
    p = await pack(page, 'Browser sealed pack');
  await post(page, `/channels/${c.id}/allocations`, {
    listing_id: p.listing_id,
    slot: 'browser-pack',
  });
  await switchUser(page, 'collector');
  await page.goto(`/channels/${c.id}`);
  await page.getByRole('button', { name: 'Review purchase', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Review channel purchase' })).toContainText('$20');
  await page.getByRole('button', { name: 'Confirm terms and continue to payment' }).click();
  await expect(page).toHaveURL(/\/account\/orders\//);
  const orderPath = new URL(page.url()).pathname;
  await page.getByRole('button', { name: 'Complete demo payment' }).click();
  await expect(page.getByText('awaiting fulfillment', { exact: true })).toBeVisible();
  await switchUser(page, 'ops');
  await page.goto('/workspace/channels');
  const order = page.locator('details.panel').filter({
    has: page
      .locator('summary')
      .filter({ hasText: new RegExp(`LIVEUP · ${orderPath.split('/').at(-1)!.slice(0, 8)}`) }),
  });
  await order.locator('summary').first().click();
  await order
    .getByLabel('Recording reference', { exact: true })
    .fill('recording:browser-physical-session');
  await order.getByLabel('Recording offset (milliseconds)').fill('2500');
  await order
    .getByLabel(/Evidence or tracking reference/)
    .fill('Host observed seal opening and the physical card');
  await order
    .getByLabel(/One physical item per line/)
    .fill('Browser revealed card | Physical card serial checked on camera');
  await order.getByRole('button', { name: 'Record reveal and ownership lineage' }).click();
  await expect(order.locator('summary').first()).toContainText('fulfilled');
  await page.goto('/workspace/developer');
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('heading', { name: 'Create a 30-day credential' }) });
  await form.getByLabel('Credential name').fill('Browser discovery client');
  await form.getByLabel('Allowed tools').selectOption('query,match,route');
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel('Bearer credential')).not.toHaveValue('');
  await page.getByLabel('Title search').fill('Orbital');
  await page.getByRole('button', { name: 'Run tool', exact: true }).click();
  await expect(page.getByText('Usage today: 1/100')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Revoke credential', exact: true }).last().click();
  await page.getByRole('button', { name: 'Run tool', exact: true }).click();
  await expect(page.locator('.error-notice')).toContainText('revoked');
  await switchUser(page, 'collector');
  await page.goto(orderPath);
  await expect(page.getByText(/recording:browser-physical-session/)).toBeVisible();
  await page.getByRole('link', { name: 'Browser revealed card', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Item passport' })).toContainText(
    'Not yet VIA assessed',
  );
  expect(errors).toEqual([]);
});

test('GOUP participant pledges then pays their own fixed share through shared checkout', async ({
  page,
}) => {
  await setup(page);
  const c = await post(page, '/channels', {
      kind: 'goup',
      org_id: 'ops-org',
      name: 'Browser group',
      deadline: new Date(Date.now() + 3600000).toISOString(),
      terms: {
        description: 'One pilot participant owns and pays their own share',
        target_units: 1,
        shipping_total_cents: 501,
      },
    }),
    p = await pack(page, 'Group physical pack');
  await post(page, `/channels/${c.id}/allocations`, {
    listing_id: p.listing_id,
    slot: 'participant-1',
  });
  await switchUser(page, 'collector');
  await page.goto(`/channels/${c.id}`);
  await page.getByRole('button', { name: 'Accept terms and pledge this share' }).click();
  await expect(page.getByRole('button', { name: 'Your share is pledged' })).toBeVisible();
  await switchUser(page, 'ops');
  await post(page, `/channels/${c.id}/lock`);
  await switchUser(page, 'collector');
  await page.goto(`/channels/${c.id}`);
  await page.getByRole('button', { name: 'Review purchase', exact: true }).click();
  await page
    .getByLabel('Delivery address', { exact: true })
    .fill('123 Participant Street, Pilot City');
  await expect(page.getByRole('region', { name: 'Review channel purchase' })).toContainText(
    '$25.01',
  );
  await page.getByRole('button', { name: 'Confirm terms and continue to payment' }).click();
  await expect(page).toHaveURL(/\/account\/orders\//);
  await page.getByRole('button', { name: 'Complete demo payment' }).click();
  await expect(page.getByRole('heading', { name: 'GOUP fulfillment' })).toBeVisible();
  await expect(page.getByText('awaiting fulfillment', { exact: true })).toBeVisible();
});

test('CVM browser purchase stays pending physical fulfillment until signed device outcome', async ({
  page,
}) => {
  await setup(page);
  const key = generateKeyPairSync('ed25519'),
    publicKey = key.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const c = await post(page, '/channels', {
      kind: 'cvm',
      org_id: 'ops-org',
      name: 'Browser device',
      terms: { description: 'Device pilot with signed physical outcome' },
      public_key: publicKey,
    }),
    p = await pack(page, 'Device physical pack');
  await post(page, `/channels/${c.id}/allocations`, { listing_id: p.listing_id, slot: 'A1' });
  async function event(data: unknown) {
    const body = JSON.stringify(data),
      timestamp = String(Date.now());
    const r = await page.request.post(`/api/devices/${c.id}/events`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Timestamp': timestamp,
        'X-Device-Signature': sign(
          null,
          Buffer.from(`${c.id}\n${timestamp}\n${body}`),
          key.privateKey,
        ).toString('base64'),
      },
      data: body,
    });
    expect(r.status()).toBe(200);
    return r.json();
  }
  await event({ event_id: randomUUID(), type: 'heartbeat' });
  await switchUser(page, 'collector');
  await page.goto(`/channels/${c.id}`);
  await page.getByRole('button', { name: 'Review purchase', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm terms and continue to payment' }).click();
  await page.getByRole('button', { name: 'Complete demo payment' }).click();
  await expect(page.getByText('awaiting fulfillment', { exact: true })).toBeVisible();
  let command: any;
  await expect
    .poll(async () => {
      const r = await event({ event_id: randomUUID(), type: 'heartbeat' });
      command ||= r.commands[0];
      return !!command;
    })
    .toBe(true);
  await event({
    event_id: randomUUID(),
    type: 'vend',
    command_id: command.id,
    outcome: 'delivered',
    evidence: 'Browser simulator signed successful delivery',
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'A new chapter, confirmed.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'CVM fulfillment' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
