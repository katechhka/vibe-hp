import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
await fs.mkdir('docs/screenshots', { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const failures = [];
const errors = [];
const expectedNotFoundMessages = [];
let checkingNotFound = false;
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') {
    if (checkingNotFound && m.text().includes('404'))
      expectedNotFoundMessages.push(m.text());
    else errors.push(m.text());
  }
});
page.on('response', (r) => {
  if (
    r.status() >= 400 &&
    !r.url().includes('/products/missing') &&
    !r.url().includes('/nothing-here')
  )
    errors.push(r.status() + ' ' + r.url());
});
const base = 'http://127.0.0.1:3000';
async function visit(route) {
  await page.goto(base + route, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('h1').count(), 1, 'One h1: ' + route);
}
async function capture(name) {
  await page.screenshot({
    path: 'docs/screenshots/' + name + '.png',
    fullPage: true,
  });
}
await visit('/');
await capture('home-desktop');
await page.screenshot({
  path: 'docs/screenshots/home-first-screen.png',
  fullPage: false,
});
await page.getByRole('button', { name: 'Следующие товары' }).click();
await page.waitForFunction(
  () => document.querySelector('.product-carousel').scrollLeft > 0
);
assert(
  (await page.locator('.product-carousel').evaluate((e) => e.scrollLeft)) > 0,
  'Carousel next'
);
await visit('/catalog');
await expect(page.locator('.catalog-grid .product-card')).toHaveCount(12);
await page.getByRole('button', { name: 'Блокноты', exact: true }).click();
await expect(page.locator('.catalog-grid .product-card')).toHaveCount(2);
await page.getByRole('combobox').selectOption('price-desc');
assert.match(page.url(), /sort=price-desc/);
await page.getByRole('searchbox').fill('неттакойвещи');
await expect(page.locator('.catalog-grid .product-card')).toHaveCount(0);
await page.getByRole('button', { name: 'Показать все вещи' }).click();
await expect(page.locator('.catalog-grid .product-card')).toHaveCount(12);
await capture('catalog-desktop');
await visit('/products/night-library');
await capture('product-desktop');
await page.getByRole('button', { name: 'Деталь 1', exact: true }).click();
assert.equal(
  await page
    .getByRole('button', { name: 'Деталь 1', exact: true })
    .getAttribute('aria-pressed'),
  'true'
);
await page.getByRole('button', { name: 'В точку', exact: true }).click();
await page.getByRole('button', { name: 'Добавить в корзину' }).click();
await visit('/cart');
assert.match(await page.locator('.cart-line').innerText(), /В точку/);
await capture('cart-desktop');
await page.reload({ waitUntil: 'networkidle' });
await expect(page.locator('.cart-line')).toHaveCount(1);
await visit('/checkout');
await capture('checkout-desktop');
await page.getByRole('radio', { name: /Курьером/ }).check();
assert.match(
  await page.locator('.checkout-summary .summary-total').innerText(),
  /2\s340/
);
await page.getByRole('radio', { name: /В пункт выдачи/ }).check();
assert.match(
  await page.locator('.checkout-summary .summary-total').innerText(),
  /2\s040/
);
await page.getByRole('button', { name: 'К демонстрационной оплате' }).click();
assert((await page.locator('.field-error').count()) >= 5);
await page.getByLabel('Ваше имя', { exact: true }).fill('Ася');
await page.getByLabel('Email', { exact: true }).fill('asya@example.com');
await page.getByLabel('Телефон', { exact: true }).fill('+7 999 123-45-67');
await page.getByLabel('Город', { exact: true }).fill('Москва');
await page
  .getByLabel('Адрес пункта выдачи', { exact: true })
  .fill('Тестовая улица, 12');
await page.locator('.consents input').nth(0).check();
await page.locator('.consents input').nth(1).uncheck();
await page.getByRole('button', { name: 'К демонстрационной оплате' }).click();
assert.match(
  await page.locator('.consents').innerText(),
  /Подтвердите, что это демонстрация/
);
await page.reload({ waitUntil: 'networkidle' });
assert.equal(
  await page.getByLabel('Ваше имя', { exact: true }).inputValue(),
  'Ася'
);
for (const state of ['pending', 'success', 'error', 'canceled']) {
  await visit('/preview/payment?state=' + state);
  await capture('payment-' + state + '-desktop');
}
await visit('/delivery');
await capture('delivery-desktop');
const productSlugs = [
  'letter',
  'owl-post',
  'castle',
  'moon-owl',
  'herbarium',
  'orbit',
  'herbal-notes',
  'night-library',
  'owl-brooch',
  'moon-vial',
  'constellation',
  'first-letter',
];
for (const slug of productSlugs) {
  await visit('/products/' + slug);
  assert.equal(
    await page
      .locator('.gallery-main img')
      .evaluate((i) => i.complete && i.naturalWidth > 0),
    true
  );
}
await visit('/products/moon-vial');
assert.equal(
  await page.getByRole('button', { name: 'Сейчас нет в наличии' }).isDisabled(),
  true
);
for (const width of [360, 390, 768, 1024, 1440]) {
  await page.setViewportSize({ width, height: 900 });
  for (const route of [
    '/',
    '/catalog',
    '/products/night-library',
    '/delivery',
    '/cart',
    '/checkout',
    '/preview/payment?state=success',
    '/privacy',
  ]) {
    await visit(route);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
    );
    if (overflow)
      failures.push('Horizontal overflow at ' + width + ' ' + route);
    if (
      [360, 768].includes(width) &&
      [
        '/',
        '/catalog',
        '/products/night-library',
        '/cart',
        '/checkout',
      ].includes(route)
    )
      await capture(
        route === '/'
          ? 'home-' + width
          : route.split('/').filter(Boolean).join('-') + '-' + width
      );
  }
}
await page.setViewportSize({ width: 390, height: 844 });
await visit('/');
await page.getByRole('button', { name: 'Открыть меню' }).click();
assert.equal(await page.locator('dialog').evaluate((e) => e.open), true);
await page.keyboard.press('Escape');
assert.equal(await page.locator('dialog').evaluate((e) => e.open), false);
assert.equal(
  await page
    .getByRole('button', { name: 'Открыть меню' })
    .evaluate((e) => e === document.activeElement),
  true
);
await page.getByRole('button', { name: 'Открыть меню' }).click();
await page
  .getByRole('navigation', { name: 'Мобильная навигация' })
  .getByRole('link', { name: 'Каталог' })
  .click();
await page.waitForURL('**/catalog');
assert.match(page.url(), /catalog/);
assert.equal(await page.locator('dialog').evaluate((e) => e.open), false);
await visit('/cart');
await page.getByRole('button', { name: 'Убрать из корзины' }).click();
await expect(page.locator('.cart-line')).toHaveCount(0);
await capture('cart-empty-mobile');
checkingNotFound = true;
const response = await page.goto(base + '/products/missing', {
  waitUntil: 'networkidle',
});
// Next.js may start streaming the dynamic layout before notFound(); require its UI and noindex.
assert.ok([200, 404].includes(response.status()));
await expect(page.locator('.error-number')).toHaveText('404');
await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toHaveCount(1);
await capture('404-mobile');
checkingNotFound = false;
await page.emulateMedia({ reducedMotion: 'reduce' });
await visit('/');
assert.equal(
  await page.evaluate(
    () => getComputedStyle(document.documentElement).scrollBehavior
  ),
  'auto'
);
await fs.writeFile(
  'docs/ui-check-results.json',
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      widths: [360, 390, 768, 1024, 1440],
      products: 12,
      checks: [
        'routes',
        'filters',
        'search-empty-reset',
        'sort-query',
        'carousel',
        'gallery',
        'variants',
        'cart-persistence',
        'checkout-validation',
        'draft-persistence',
        'payment-layouts',
        'unavailable-product',
        'mobile-menu-escape-focus',
        '404',
        'reduced-motion',
        'horizontal-overflow',
      ],
      expectedNotFoundMessages,
      errors,
      failures,
    },
    null,
    2
  )
);
await browser.close();
assert.equal(failures.length, 0, failures.join('\n'));
assert.equal(errors.length, 0, errors.join('\n'));
console.log(
  'PASS: all UI checks, 12 products, 5 viewport widths, no page/resource errors or horizontal overflow.'
);
