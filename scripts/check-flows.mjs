import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { products } from '../src/data/catalog.ts';
const browser = await chromium.launch({
  executablePath:
    process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const notebook = products.find((p) => p.slug === 'night-library');
const results = [];
const errors = [];
async function scenario(name, run) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  try {
    await run(context);
    results.push({ name, passed: true });
  } catch (e) {
    results.push({ name, passed: false, message: e.message });
    throw e;
  } finally {
    await context.close();
  }
}
async function pageFor(context, cart, draft) {
  if (cart !== undefined || draft !== undefined)
    await context.addInitScript(
      ({ cart, draft }) => {
        if (cart !== undefined && localStorage.getItem('ps-cart-v1') === null)
          localStorage.setItem(
            'ps-cart-v1',
            typeof cart === 'string' ? cart : JSON.stringify(cart)
          );
        if (
          draft !== undefined &&
          sessionStorage.getItem('ps-checkout-draft') === null
        )
          sessionStorage.setItem('ps-checkout-draft', JSON.stringify(draft));
      },
      { cart, draft }
    );
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return page;
}
async function visit(page, route) {
  await page.goto(base + route, { waitUntil: 'networkidle' });
}
try {
  await scenario(
    'Stored duplicates and shared variant stock are repaired',
    async (context) => {
      const p = await pageFor(context, [
        null,
        { id: notebook.id, variant: notebook.variants[0], quantity: 3 },
        { id: notebook.id, variant: notebook.variants[0], quantity: 1 },
        { id: notebook.id, variant: notebook.variants[1], quantity: 99 },
        { id: 'missing', variant: '', quantity: 2 },
      ]);
      await visit(p, '/cart');
      await expect(p.locator('.cart-line')).toHaveCount(2);
      assert.equal(
        await p
          .locator('.cart-line .quantity-control output')
          .allTextContents()
          .then((a) => a.map(Number).reduce((s, n) => s + n, 0)),
        5
      );
      assert.equal(
        await p
          .getByRole('button', { name: /Увеличить количество/ })
          .first()
          .isDisabled(),
        true
      );
    }
  );
  await scenario(
    'Corrupt cart has an informative recoverable empty state',
    async (context) => {
      const p = await pageFor(context, 'broken json');
      await visit(p, '/cart');
      assert.match(
        await p.locator('.empty-state').innerText(),
        /Не удалось прочитать/
      );
      await visit(p, '/products/letter');
      await p.getByRole('button', { name: 'Добавить в корзину' }).click();
      await visit(p, '/cart');
      await expect(p.locator('.cart-line')).toHaveCount(1);
    }
  );
  await scenario(
    'Twenty immediate clicks cannot exceed stock',
    async (context) => {
      const p = await pageFor(context);
      await visit(p, '/products/night-library');
      await p
        .getByRole('button', { name: 'Добавить в корзину' })
        .evaluate((button) => {
          for (let i = 0; i < 20; i++) button.click();
        });
      await visit(p, '/cart');
      assert.equal(
        await p.locator('.quantity-control output').innerText(),
        '5'
      );
    }
  );
  await scenario(
    'Changing stock clamps selected quantity; variants share remaining stock',
    async (context) => {
      const p = await pageFor(context);
      await visit(p, '/products/night-library');
      const plus = p.getByRole('button', {
        name: 'Увеличить количество',
        exact: true,
      });
      for (let i = 0; i < 3; i++) await plus.click();
      await p.getByRole('button', { name: 'Добавить в корзину' }).click();
      assert.equal(await p.locator('.purchase-row output').innerText(), '1');
      await p.getByRole('button', { name: 'В точку', exact: true }).click();
      await p.getByRole('button', { name: 'Добавить в корзину' }).click();
      assert.equal(
        await p.getByRole('button', { name: 'Всё уже в корзине' }).isDisabled(),
        true
      );
      await visit(p, '/cart');
      await expect(p.locator('.cart-line')).toHaveCount(2);
    }
  );
  await scenario(
    'Cart updates across tabs and survives reload',
    async (context) => {
      const a = await pageFor(context);
      await visit(a, '/cart');
      const b = await pageFor(context);
      await visit(b, '/products/letter');
      await b.getByRole('button', { name: 'Добавить в корзину' }).click();
      await a.locator('.cart-line').waitFor();
      assert.equal(
        await a.locator('.quantity-control output').innerText(),
        '1'
      );
      await a
        .getByRole('button', { name: 'Увеличить количество: Письмо из замка' })
        .click();
      await b.waitForFunction(
        () => document.querySelector('.cart-count').textContent === '2'
      );
      await a.reload({ waitUntil: 'networkidle' });
      assert.equal(
        await a.locator('.quantity-control output').innerText(),
        '2'
      );
    }
  );
  await scenario(
    'Catalogue direct URLs, back/forward and malformed filters',
    async (context) => {
      const p = await pageFor(context);
      await visit(p, '/catalog?category=notebooks&sort=price-desc');
      await expect(p.locator('.catalog-grid .product-card')).toHaveCount(2);
      assert.match(
        await p.locator('.catalog-grid .product-card').first().innerText(),
        /Ночная библиотека/
      );
      await p.getByRole('button', { name: 'Украшения', exact: true }).click();
      await p.goBack({ waitUntil: 'networkidle' });
      await expect(p.locator('.catalog-grid .product-card')).toHaveCount(2);
      assert.match(
        await p.locator('.catalog-grid .product-card').first().innerText(),
        /Ночная библиотека/
      );
      await p.goForward({ waitUntil: 'networkidle' });
      assert.match(
        await p.locator('.catalog-grid .product-card').first().innerText(),
        /Почтовая сова/
      );
      await visit(p, '/catalog?category=forged&sort=forged');
      await expect(p.locator('.catalog-grid .product-card')).toHaveCount(12);
    }
  );
  await scenario(
    'Independent delivery addresses, invalid phone and draft restoration',
    async (context) => {
      const p = await pageFor(context, [
        { id: notebook.id, variant: notebook.variants[0], quantity: 1 },
      ]);
      await visit(p, '/checkout');
      await p.getByLabel('Ваше имя', { exact: true }).fill('Ася');
      await p.getByLabel('Email', { exact: true }).fill('asya@example.com');
      await p.getByLabel('Телефон', { exact: true }).fill('abc79991234567');
      await p.getByLabel('Город', { exact: true }).fill('Москва');
      await p
        .getByLabel('Адрес пункта выдачи', { exact: true })
        .fill('Тестовый пункт, 3');
      await p.getByRole('radio', { name: /Курьером/ }).check();
      assert.equal(
        await p
          .getByLabel('Улица, дом, квартира', { exact: true })
          .inputValue(),
        ''
      );
      await p
        .getByRole('button', { name: 'К демонстрационной оплате' })
        .click();
      assert.match(await p.locator('#phone-error').innerText(), /без букв/);
      await expect(p.locator('#courierAddress-error')).toHaveCount(1);
      await p
        .getByLabel('Улица, дом, квартира', { exact: true })
        .fill('Тестовая улица, 8');
      await p.getByRole('radio', { name: /В пункт выдачи/ }).check();
      assert.equal(
        await p.getByLabel('Адрес пункта выдачи', { exact: true }).inputValue(),
        'Тестовый пункт, 3'
      );
      await p.reload({ waitUntil: 'networkidle' });
      await p.getByRole('radio', { name: /Курьером/ }).check();
      assert.equal(
        await p
          .getByLabel('Улица, дом, квартира', { exact: true })
          .inputValue(),
        'Тестовая улица, 8'
      );
      await p.getByLabel('Телефон', { exact: true }).fill('+7 999 123-45-67');
      await p.locator('.consents input').nth(0).check();
      await p.locator('.consents input').nth(1).uncheck();
      await p
        .getByRole('button', { name: 'К демонстрационной оплате' })
        .click();
      assert.match(
        await p.locator('.consents').innerText(),
        /Подтвердите, что это демонстрация/
      );
      await p.getByRole('button', { name: 'Очистить черновик' }).click();
      await p.reload({ waitUntil: 'networkidle' });
      assert.equal(
        await p.getByLabel('Ваше имя', { exact: true }).inputValue(),
        ''
      );
    }
  );
  await scenario(
    'Disabled browser storage is explained instead of silently losing cart',
    async (context) => {
      await context.addInitScript(() => {
        Storage.prototype.setItem = function () {
          throw new DOMException('Blocked', 'QuotaExceededError');
        };
      });
      const p = await pageFor(context);
      await visit(p, '/products/letter');
      await p.getByRole('button', { name: 'Добавить в корзину' }).click();
      assert.match(
        await p.locator('.product-info .stage-note').innerText(),
        /Браузер не разрешает/
      );
      await p.getByRole('link', { name: /Открыть корзину/ }).click();
      await p.waitForURL('**/cart');
      await expect(p.locator('.cart-line')).toHaveCount(1);
    }
  );
  await scenario(
    'Gallery supports keyboard and ignores vertical scrolling gestures',
    async (context) => {
      const p = await pageFor(context);
      await visit(p, '/products/night-library');
      const gallery = p.getByRole('region', { name: 'Галерея товара' });
      await gallery.focus();
      await p.keyboard.press('ArrowRight');
      assert.match(await p.locator('.gallery-counter').innerText(), /02/);
      const gesture = async (from, to) =>
        gallery.evaluate(
          (element, { from, to }) => {
            const a = new Touch({
              identifier: 1,
              target: element,
              clientX: from.x,
              clientY: from.y,
            });
            const b = new Touch({
              identifier: 1,
              target: element,
              clientX: to.x,
              clientY: to.y,
            });
            element.dispatchEvent(
              new TouchEvent('touchstart', {
                bubbles: true,
                touches: [a],
                changedTouches: [a],
              })
            );
            element.dispatchEvent(
              new TouchEvent('touchend', {
                bubbles: true,
                touches: [],
                changedTouches: [b],
              })
            );
          },
          { from, to }
        );
      await gesture({ x: 100, y: 100 }, { x: 110, y: 230 });
      await expect(p.locator('.gallery-counter')).toContainText('02');
      await gesture({ x: 250, y: 100 }, { x: 80, y: 110 });
      await expect(p.locator('.gallery-counter')).toContainText('01');
    }
  );
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    'PASS: ' +
      results.length +
      ' edge-case browser scenarios; no JavaScript or console errors.'
  );
} finally {
  await fs.mkdir('docs', { recursive: true });
  await fs.writeFile(
    'docs/flow-check-results.json',
    JSON.stringify(
      { testedAt: new Date().toISOString(), results, errors },
      null,
      2
    )
  );
  await browser.close();
}
