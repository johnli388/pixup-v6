import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  locales,
  resolveLocale,
  translate,
  formatMoney,
  formatDate,
  pluralMessage,
} from '../packages/domain/i18n';
import { messages } from '../packages/domain/i18n/messages';
import { assistantInput } from '../packages/domain/assistant';
import { localAssistantPlan } from '../apps/api/src/assistant';

test('locale negotiation respects saved choice, regional languages, quality and invalid preferences', () => {
  assert.equal(resolveLocale('es', 'fr-CA,ja;q=0.8'), 'es');
  assert.equal(resolveLocale(undefined, 'de-DE,fr-CA;q=0.9,es;q=0.8'), 'fr');
  assert.equal(resolveLocale(undefined, 'en;q=0,ja-JP;q=0.5'), 'ja');
  assert.equal(resolveLocale(undefined, 'zh-Hans-CN'), 'zh-CN');
  assert.equal(resolveLocale(undefined, 'KO-kr'), 'ko');
  assert.equal(resolveLocale('<script>', 'unknown,es;q=broken,fr;q=2,*'), 'en');
  assert.equal(resolveLocale(undefined, 'fr;q=0,ja;q=-1'), 'en');
});

test('translation catalogs preserve interpolation and safely fall back to source text', () => {
  const placeholders = (value: string) =>
    [...value.matchAll(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g)].map((match) => match[1]).sort();
  for (const [key, translations] of Object.entries(messages)) {
    assert.equal(translations.length, 5, key);
    for (const translated of translations) {
      assert.ok(translated.trim(), key);
      assert.deepEqual(placeholders(translated), placeholders(key), key);
    }
  }
  assert.equal(translate('fr', '  Sign in '), '  Se connecter ');
  assert.equal(translate('ja', 'An unknown provider message.'), 'An unknown provider message.');
  assert.equal(
    translate('en', 'Order {id}', { id: '<script>literal</script>' }),
    'Order <script>literal</script>',
  );
  assert.equal(translate('fr', '{constructor}'), '{constructor}');
});

test('formatting changes locale without converting USD or changing the underlying date', () => {
  assert.equal(formatMoney(5800, 'en'), '$58');
  assert.match(formatMoney(5800, 'ja'), /58/);
  assert.match(formatMoney(5800, 'fr'), /58/);
  assert.notEqual(formatMoney(580050, 'fr'), formatMoney(580050, 'en'));
  assert.equal(formatDate('invalid', 'ko'), '—');
  assert.equal(formatDate('2026-10-30T23:30:00Z', 'en'), 'Oct 30, 2026');
  assert.equal(formatDate('2026-10-30T23:30:00Z', 'zh-CN'), '2026年10月30日');
  assert.equal(
    pluralMessage('es', 1, '{count} collectible', '{count} collectibles'),
    '1 coleccionable',
  );
  assert.equal(
    pluralMessage('es', 2, '{count} collectible', '{count} collectibles'),
    '2 coleccionables',
  );
});

test('all localized suggestions retain their intent, budget and private search boundary', () => {
  for (const locale of locales) {
    const plan = (message: string) => localAssistantPlan(assistantInput.parse({ message, locale }));
    assert.deepEqual(
      plan(translate(locale, 'Find sports cards under $100')),
      { intent: 'cards', query: '', category: 'Sports', max_price_cents: 10000 },
      locale,
    );
    assert.equal(
      plan(translate(locale, 'Show sellers with K-pop cards')).intent,
      'sellers',
      locale,
    );
    assert.equal(plan(translate(locale, 'Find buyers from my sales')).intent, 'buyers', locale);
    assert.equal(plan(translate(locale, 'Show my orders')).intent, 'orders', locale);
    assert.equal(plan(translate(locale, 'How do I sell a card?')).intent, 'help', locale);
    assert.equal(plan(translate(locale, 'What is RePool?')).intent, 'help', locale);
  }
  for (const message of [
    'Busca cartas deportivas por menos de 75 dólares',
    'Trouver des cartes de sport à moins de 75 $',
    '找75美元以下的体育卡牌',
    '75ドル以下のスポーツカードを探して',
    '75달러 이하 스포츠 카드 찾아줘',
  ]) {
    const plan = localAssistantPlan(assistantInput.parse({ message }));
    assert.equal(plan.category, 'Sports', message);
    assert.equal(plan.max_price_cents, 7500, message);
    assert.equal(plan.query, '', message);
  }
  assert.equal(
    localAssistantPlan(assistantInput.parse({ message: 'Muestra compradores de mis ventas' }))
      .intent,
    'buyers',
  );
  assert.equal(assistantInput.parse({ message: 'Find cards' }).locale, 'en');
  assert.throws(() => assistantInput.parse({ message: 'Find cards', locale: '<script>' }));
});
