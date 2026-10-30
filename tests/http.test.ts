import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, migrate } from '../packages/database/index';
import { seed } from '../packages/database/seed';
import { createApp, Services } from '../apps/api/src/app';
import sharp from 'sharp';
import { apiErrorSchema, organizationSchema } from '../packages/domain/contracts';

test('HTTP authentication, validation, session isolation, CSRF and public verification', async () => {
  const db = await openDatabase();
  await migrate(db);
  await seed(db);
  const server = createApp(new Services(db)).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  try {
    const unauthorized = await fetch(base + '/portfolio');
    assert.equal(unauthorized.status, 401);
    const unauthorizedError = apiErrorSchema.parse(await unauthorized.json());
    assert.equal(unauthorizedError.retryable, false);
    assert.equal(unauthorizedError.correlation_id, unauthorized.headers.get('x-correlation-id'));
    apiErrorSchema.parse(await (await fetch(base + '/unknown')).json());
    const login = await fetch(base + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'collector@pixup.demo', password: 'PixupDemo2026!' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0],
      { user } = await login.json();
    assert(login.headers.get('set-cookie')!.includes('HttpOnly'));
    assert(login.headers.get('set-cookie')!.includes('SameSite=Strict'));
    const headers = { 'Content-Type': 'application/json', cookie };
    assert.equal(
      (await fetch(base + '/assets', { method: 'POST', headers, body: '{}' })).status,
      403,
    );
    const validHeaders = { ...headers, 'X-CSRF-Token': user.csrf };
    const organizations = await (await fetch(base + '/me/organizations', { headers })).json();
    assert.equal(organizationSchema.array().parse(organizations)[0].kind, 'personal');
    assert.equal(
      (await fetch(base + '/assets', { method: 'POST', headers: validHeaders, body: '{}' })).status,
      400,
    );
    assert.equal((await fetch(base + '/ops', { headers })).status, 403);
    const png = await sharp({
      create: { width: 16, height: 20, channels: 3, background: '#719657' },
    })
      .png()
      .toBuffer();
    const uploaded = await fetch(base + '/uploads', {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'image/png', 'X-CSRF-Token': user.csrf },
      body: new Uint8Array(png),
    });
    assert.equal(uploaded.status, 200);
    const media = await uploaded.json();
    assert.equal((await fetch(base + '/media/' + media.id)).status, 404);
    const ownedImage = await fetch(base + '/media/' + media.id, { headers });
    assert.equal(ownedImage.status, 200);
    assert.equal(ownedImage.headers.get('content-type'), 'image/webp');
    assert.equal((await fetch(base + '/creator/creator-org', { headers })).status, 403);
    assert.equal(
      (
        await fetch(base + '/auth/logout', {
          method: 'POST',
          headers: { ...validHeaders, Origin: 'https://untrusted.invalid' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal((await fetch(base + '/certificates/VIA-000001/verify')).status, 200);
    const spec = await (await fetch(base + '/openapi.json')).json();
    assert(spec.paths['/checkouts'].post.requestBody);
    assert(spec.paths['/me/organizations'].get.responses['200'].content['application/json'].schema);
    assert(
      spec.paths['/checkouts'].post.responses['400'].content['application/json'].schema.properties
        .retryable,
    );
    const logOut = await fetch(base + '/auth/logout', {
      method: 'POST',
      headers: validHeaders,
      body: '{}',
    });
    assert.equal(logOut.status, 200);
    assert.equal((await fetch(base + '/portfolio', { headers })).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.close();
  }
});
