import { test, expect } from './fixtures';
import AxeBuilder from '@axe-core/playwright';

const languages = [
  { code: 'en', heading: 'Collect what moves you', market: 'The marketplace', sports: 'Sports' },
  { code: 'es', heading: 'Colecciona lo que te inspira', market: 'El mercado', sports: 'Deportes' },
  {
    code: 'fr',
    heading: 'Collectionnez ce qui vous inspire',
    market: 'Le marché',
    sports: 'Sport',
  },
  { code: 'zh-CN', heading: '收藏心之所动', market: '藏品市场', sports: '体育' },
  { code: 'ja', heading: '心が動くものを集めよう', market: 'マーケット', sports: 'スポーツ' },
  {
    code: 'ko',
    heading: '마음을 움직이는 것을 모으세요',
    market: '마켓플레이스',
    sports: '스포츠',
  },
];

test('all six languages persist across navigation and reload while preserving catalog identities', async ({
  page,
}) => {
  for (const language of languages) {
    await page.goto('/');
    await page.locator('.language-selector select').selectOption(language.code);
    await expect(page.locator('html')).toHaveAttribute('lang', language.code);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(language.heading);
    await page.locator('aside a[href="/marketplace"]').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(language.market);
    await page.locator('.tabs').getByRole('button', { name: language.sports, exact: true }).click();
    await expect(page.getByText('Full Court · Silver Parallel', { exact: true })).toBeVisible();
    await expect(page.locator('.item-card').first()).toBeVisible();
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', language.code);
    await expect(page.locator('.language-selector select')).toHaveValue(language.code);
    const html = await (await page.request.get('/marketplace')).text();
    expect(html).toContain(`lang="${language.code}"`);
    expect(html).toContain(language.market);
  }
});

test('language changes preserve input and localized options keep their API values', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email address', { exact: true }).fill('kept@example.test');
  await page.locator('.language-selector select').selectOption('fr');
  await expect(page.getByLabel('Adresse e-mail', { exact: true })).toHaveValue('kept@example.test');
  await page.goto('/marketplace');
  await page.locator('.sort-control select').selectOption({ label: 'Prix croissant' });
  await expect(page.locator('.sort-control select')).toHaveValue('low');
  await page.locator('.language-selector select').selectOption('ko');
  await expect(page.locator('.sort-control select')).toHaveValue('low');
  await expect(page.locator('.sort-control option:checked')).toHaveText('가격 낮은 순');
});

test('server locale negotiation and concurrent visitors are isolated, including 404s', async ({
  browser,
}) => {
  const french = await browser.newContext({
    extraHTTPHeaders: { 'Accept-Language': 'fr-CA,fr;q=0.9,en;q=0.5' },
  });
  const english = await browser.newContext({ extraHTTPHeaders: { 'Accept-Language': 'en-US' } });
  try {
    const [fr, en] = await Promise.all([
      french.request.get('http://127.0.0.1:3100/'),
      english.request.get('http://127.0.0.1:3100/'),
    ]);
    expect(await fr.text()).toContain('lang="fr"');
    expect(await en.text()).toContain('lang="en"');
    await french.addCookies([
      { name: 'pixup_locale', value: 'ja', domain: '127.0.0.1', path: '/' },
    ]);
    const missing = await french.request.get('http://127.0.0.1:3100/no-such-pixup-page');
    expect(missing.status()).toBe(404);
    const page = await french.newPage();
    await page.goto('http://127.0.0.1:3100/no-such-pixup-page');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ページが見つかりません。');
  } finally {
    await french.close();
    await english.close();
  }
});

test('localized assistant searches actual inventory and preserves chat when language changes', async ({
  page,
}) => {
  const login = await page.request.post('/api/auth/login', {
    data: { email: 'collector@pixup.demo', password: 'PixupDemo2026!' },
  });
  expect(login.status()).toBe(200);
  await page.goto('/assistant');
  await page.locator('.language-selector select').selectOption('es');
  await page
    .getByRole('button', { name: 'Busca cartas deportivas por menos de $100', exact: true })
    .click();
  await expect(page.getByRole('log')).toContainText('Estas son las cartas coincidentes');
  await expect(page.getByRole('log')).toContainText('Full Court · Silver Parallel');
  await page.locator('.language-selector select').selectOption('ja');
  await expect(page.getByRole('log')).toContainText('Estas son las cartas coincidentes');
  await page.getByRole('button', { name: '自分の注文を表示', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('ご自身の取引履歴のみ検索します');
  await expect(page).toHaveTitle('PixUPに質問 · PixUP');
});

test('language selection remains accessible on a narrow mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
  await page.locator('.language-selector select').selectOption('zh-CN');
  await expect(page.getByLabel('语言', { exact: true })).toHaveValue('zh-CN');
  await page.getByRole('button', { name: '关闭导航', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('收藏心之所动');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
