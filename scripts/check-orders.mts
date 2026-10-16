import {
  chromium,
  expect as baseExpect,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
const expect = baseExpect.configure({ timeout: 30000 });
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3001';
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const errors: string[] = [],
  checks: string[] = [];
const fields = {
  name: 'Тестовая Ася',
  email: 'test@example.com',
  phone: '+7 999 123-45-67',
  city: 'Москва',
  pickupAddress: 'Тестовый пункт, 3',
  courierAddress: '',
  comment: '',
  delivery: 'pickup',
  consent: true,
  demo: true,
};
const seed = [{ id: 'ps-001', variant: '', quantity: 1 }];
async function pageFor(context: BrowserContext) {
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error' && !e.text().includes('404'))
      errors.push(e.text());
  });
  await page.addInitScript(
    ({ seed, fields }) => {
      if (localStorage.getItem('ps-cart-v1') === null)
        localStorage.setItem('ps-cart-v1', JSON.stringify(seed));
      if (sessionStorage.getItem('ps-checkout-draft') === null)
        sessionStorage.setItem('ps-checkout-draft', JSON.stringify(fields));
    },
    { seed, fields }
  );
  return page;
}
async function post(
  context: BrowserContext,
  path: string,
  data: unknown,
  origin = base
) {
  return context.request.post(base + path, {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data,
  });
}
async function capture(page: Page, name: string) {
  mkdirSync('docs/screenshots', { recursive: true });
  await page.screenshot({
    path: 'docs/screenshots/' + name + '.png',
    fullPage: true,
  });
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await pageFor(context);
  await page.goto(base + '/', { waitUntil: 'networkidle', timeout: 60000 });
  await expect(page.locator('h1')).toBeVisible();
  await page
    .getByRole('link', { name: 'Заглянуть в каталог', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/catalog/);
  await page.goto(base + '/products/letter');
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await page.goto(base + '/cart');
  await expect(page.locator('.quantity-control output')).toHaveText('2');
  await page.getByRole('link', { name: 'К оформлению' }).click();
  await page.locator('.consents input').nth(0).check();
  await page.locator('.consents input').nth(1).check();
  await capture(page, 'checkout-stage4-desktop');
  await page
    .getByRole('button', { name: 'К демонстрационной оплате' })
    .evaluate((button) => {
      for (let i = 0; i < 12; i++) (button as HTMLButtonElement).click();
    });
  await page.waitForURL(/\/orders\/[^/]+\/demo$/);
  const orderId = page.url().split('/').at(-2)!;
  const initialResponse = await context.request.get(
    base + '/api/orders/' + orderId
  );
  assert.equal(initialResponse.status(), 200);
  const initial = (await initialResponse.json()).order;
  assert.equal(initial.total, 93000);
  assert.equal(initial.status, 'pending');
  const cookie = (await context.cookies()).find(
    (c) => c.name === 'ps-order-session'
  )!;
  assert.ok(cookie.httpOnly);
  assert.equal(cookie.sameSite, 'Lax');
  checks.push(
    'Main purchase route creates one persisted order; server total 930 ₽ and HttpOnly access cookie'
  );
  const pending = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('ps-checkout-request')!)
  );
  const snapshot = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('ps-cart-v1')!)
  );
  const payload = {
    requestKey: pending.key,
    fields,
    items: snapshot,
    expectedTotal: 93000,
  };
  const duplicates = await Promise.all(
    Array.from({ length: 6 }, () => post(context, '/api/orders', payload))
  );
  for (const response of duplicates) {
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).order.id, orderId);
  }
  const wrongPrice = structuredClone(payload);
  (wrongPrice.items[0] as any).price = 1;
  wrongPrice.requestKey = randomUUID();
  assert.equal((await post(context, '/api/orders', wrongPrice)).status(), 400);
  assert.equal(
    (
      await post(context, '/api/orders', {
        ...payload,
        requestKey: randomUUID(),
        expectedTotal: 1,
      })
    ).status(),
    409
  );
  assert.equal(
    (
      await post(context, '/api/orders', payload, 'https://untrusted.example')
    ).status(),
    403
  );
  assert.equal(
    (
      await post(context, '/api/orders', {
        ...payload,
        fields: { ...fields, phone: 'letters123' },
      })
    ).status(),
    400
  );
  checks.push(
    'Parallel repeated requests share order; price, phone and cross-origin tampering rejected'
  );
  const stranger = await browser.newContext();
  assert.equal(
    (await stranger.request.get(base + '/api/orders/' + orderId)).status(),
    404
  );
  const otherPage = await stranger.newPage();
  const unauthorized = await otherPage.goto(base + '/orders/' + orderId);
  assert.ok([200, 404].includes(unauthorized!.status()));
  await expect(otherPage.locator('.error-number')).toHaveText('404');
  await expect(otherPage.locator('.result-order')).toHaveCount(0);
  await stranger.close();
  assert.ok(!JSON.stringify(initial).includes(fields.email));
  checks.push('Foreign browser cannot access order; API status omits contacts');
  await page.goto(base + '/orders/' + orderId + '?state=success');
  await expect(page.getByTestId('order-status')).toHaveText(
    'Ожидает демооплаты'
  );
  await page.getByRole('link', { name: 'К демонстрационной оплате' }).click();
  await capture(page, 'demo-payment-desktop');
  await page.getByRole('button', { name: 'Проверить ошибку' }).click();
  await page.waitForURL(base + '/orders/' + orderId);
  await expect(page.getByTestId('order-status')).toHaveText(
    'Ошибка демооплаты'
  );
  await capture(page, 'order-error-desktop');
  await page.getByRole('link', { name: 'Вернуться к оформлению' }).click();
  await expect(page.getByLabel('Ваше имя', { exact: true })).toHaveValue(
    fields.name
  );
  await page
    .getByRole('link', { name: 'Посмотреть статус и повторить оплату →' })
    .click();
  await page.getByRole('button', { name: 'Повторить демооплату' }).click();
  await page.waitForURL(base + '/orders/' + orderId + '/demo');
  await page.getByRole('button', { name: 'Отменить демооплату' }).click();
  await page.waitForURL(base + '/orders/' + orderId);
  await expect(page.getByTestId('order-status')).toHaveText(
    'Демооплата отменена'
  );
  await capture(page, 'order-canceled-desktop');
  const retryKey = randomUUID();
  const retried = await Promise.all(
    Array.from({ length: 5 }, () =>
      post(context, '/api/orders/' + orderId + '/retry', {
        requestKey: retryKey,
      })
    )
  );
  const retryOrder = (await retried[0].json()).order;
  for (const response of retried)
    assert.equal(
      (await response.json()).order.activeAttempt,
      retryOrder.activeAttempt
    );
  assert.notEqual(retryOrder.activeAttempt, initial.activeAttempt);
  assert.equal(
    (
      await post(context, '/api/orders/' + orderId + '/demo', {
        attemptId: initial.activeAttempt,
        result: 'succeeded',
      })
    ).status(),
    409
  );
  checks.push(
    'Failure/cancel preserve draft and cart; retry reuses order with one new attempt; stale attempt rejected'
  );
  const second = await pageFor(context);
  await second.goto(base + '/products/letter');
  await second.getByRole('button', { name: 'Добавить в корзину' }).click();
  await second.goto(base + '/products/constellation');
  await second.getByRole('button', { name: 'Добавить в корзину' }).click();
  await page.goto(base + '/orders/' + orderId + '/demo');
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await capture(page, 'demo-payment-' + width);
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      ),
      false
    );
  }
  await page.getByRole('button', { name: 'Успешная демооплата' }).click();
  await page.waitForURL(base + '/orders/' + orderId);
  await expect(page.getByTestId('order-status')).toHaveText(
    'Демооплата подтверждена'
  );
  await expect(page.getByTestId('receipt-status')).toContainText(
    'почтовый сервис пока не настроен'
  );
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await capture(page, 'order-success-' + width);
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth
      ),
      false
    );
  }
  const repeats = await Promise.all(
    Array.from({ length: 5 }, () =>
      post(context, '/api/orders/' + orderId + '/demo', {
        attemptId: retryOrder.activeAttempt,
        result: 'succeeded',
      })
    )
  );
  for (const response of repeats)
    assert.equal((await response.json()).order.status, 'paid');
  assert.equal(
    (
      await post(context, '/api/orders/' + orderId + '/demo', {
        attemptId: retryOrder.activeAttempt,
        result: 'canceled',
      })
    ).status(),
    409
  );
  await page.reload();
  await expect(page.getByTestId('order-status')).toHaveText(
    'Демооплата подтверждена'
  );
  await second.goto(base + '/cart');
  await expect(second.locator('.cart-line')).toHaveCount(2);
  await expect(
    second
      .locator('.cart-line')
      .filter({ hasText: 'Письмо из замка' })
      .locator('output')
  ).toHaveText('1');
  await page.goto(base + '/orders/' + orderId);
  await page.goto(base + '/cart');
  await expect(page.locator('.cart-line')).toHaveCount(2);
  checks.push(
    'Confirmed success clears original quantities; later same-product and unrelated additions survive across tabs and repeat visits'
  );
  // Simulate a lost response: same idempotency key after an aborted connection recovers the existing order.
  const recovery = await browser.newContext();
  const rp = await pageFor(recovery);
  await rp.goto(base + '/checkout');
  await rp.locator('.consents input').nth(0).check();
  await rp.locator('.consents input').nth(1).check();
  let lostId = '';
  await rp.route('**/api/orders', async (route) => {
    const response = await route.fetch();
    lostId = (await response.json()).order.id;
    await route.abort('failed');
  });
  await rp.getByRole('button', { name: 'К демонстрационной оплате' }).click();
  await expect(rp.locator('.checkout-notice')).not.toBeEmpty();
  await rp.unroute('**/api/orders');
  await rp.getByRole('button', { name: 'К демонстрационной оплате' }).click();
  await rp.waitForURL(/\/orders\/[^/]+\/demo$/);
  assert.equal(rp.url().split('/').at(-2), lostId);
  await rp.getByRole('button', { name: 'Отменить демооплату' }).click();
  checks.push('Lost response can be retried without creating another order');
  await context.storageState({ path: '.qa/order-restart-state.json' });
  writeFileSync('.qa/order-restart-id.txt', orderId);
  await recovery.close();
  await context.close();
  assert.deepEqual(
    errors.filter((e) => !e.includes('net::ERR_FAILED')),
    []
  );
  writeFileSync(
    'docs/order-check-results.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        base,
        checks,
        errors: errors.filter((e) => !e.includes('net::ERR_FAILED')),
      },
      null,
      2
    )
  );
  console.log(
    JSON.stringify({ passed: checks.length, checks, errors: [] }, null, 2)
  );
} finally {
  await browser.close();
}
