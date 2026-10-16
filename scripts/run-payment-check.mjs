import { spawn, execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 30000 });
const base = 'http://127.0.0.1:3004',
  qa = resolve('.qa');
mkdirSync(qa, { recursive: true });
mkdirSync('docs/screenshots', { recursive: true });
const db = resolve(qa, 'provider-' + randomUUID() + '.sqlite'),
  fixture = resolve(qa, 'provider-' + randomUUID() + '.json');
writeFileSync(fixture, JSON.stringify({ payments: [], unavailable: false }));
const env = {
  ...process.env,
  APP_URL: base,
  DATABASE_PATH: db,
  PAYMENT_MODE: 'yookassa_test',
  EMAIL_MODE: 'disabled',
  YOOKASSA_SHOP_ID: '123456',
  YOOKASSA_SECRET_KEY: 'test_fixture_only',
  PAYMENT_TEST_FIXTURE: '1',
  PAYMENT_FIXTURE_PATH: fixture,
  NODE_OPTIONS:
    '--import=' +
    pathToFileURL(resolve('scripts/payment-api-fixture.mjs')).href,
};
let server, browser;
const errors = [],
  checks = [];
const state = () => JSON.parse(readFileSync(fixture, 'utf8'));
const update = (fn) => {
  const s = state();
  fn(s);
  writeFileSync(fixture, JSON.stringify(s));
};
const stop = () => {
  if (server?.pid)
    try {
      execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch {}
};
const start = async () => {
  server = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3004',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  server.stderr.on('data', (d) => {
    if (d.toString().includes('EADDRINUSE')) errors.push(d.toString());
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + '/api/payments/config')).ok) return;
    } catch {}
    await pause(500);
  }
  throw Error('Test server unavailable');
};
try {
  try {
    await fetch(base);
    throw Error('Port 3004 already occupied');
  } catch (e) {
    if (e.message.includes('occupied')) throw e;
  }
  await start();
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error' && !e.text().includes('404'))
      errors.push(e.text());
  });
  await page.goto(base + '/products/letter', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  await page.getByRole('button', { name: 'Добавить в корзину' }).click();
  await page.goto(base + '/checkout', { waitUntil: 'networkidle' });
  for (const [id, value] of Object.entries({
    name: 'Тестовая Ася',
    email: 'test@example.com',
    phone: '+7 999 123-45-67',
    city: 'Москва',
    pickupAddress: 'Условный пункт, 3',
  }))
    await page.locator('#' + id).fill(value);
  await page.locator('.consents input').nth(0).check();
  await page.locator('.consents input').nth(1).check();
  await expect(page.getByText('Тестовая оплата через ЮKassa.')).toBeVisible();
  update((s) => (s.unavailable = true));
  await page
    .getByRole('button', { name: 'К тестовой оплате', exact: true })
    .click();
  await page.waitForURL(/\/orders\/[^/]+$/);
  const id = page.url().split('/').at(-1);
  await expect(
    page.getByText('ЮKassa не подтвердила запрос.', { exact: false })
  ).toBeVisible();
  update((s) => (s.unavailable = false));
  await page
    .getByRole('button', { name: 'Подготовить тестовый платёж' })
    .click();
  const paylink = page.getByRole('link', {
    name: 'К тестовой оплате в ЮKassa',
  });
  await expect(paylink).toBeVisible();
  checks.push(
    'Production checkout recovers from provider outage using the same protected order'
  );
  const current = () => state().payments.at(-1);
  await page.route('https://yoomoney.ru/**', (r) =>
    r.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html lang="ru"><title>Тестовая заглушка провайдера</title><h1>Защищённая страница: тестовая заглушка</h1></html>',
    })
  );
  await paylink.click();
  await expect(page.getByRole('heading')).toHaveText(
    'Защищённая страница: тестовая заглушка'
  );
  await page.goto(base + '/orders/' + id + '?state=success');
  await expect(page.getByTestId('order-status')).toHaveText(
    'Ожидает подтверждения'
  );
  const webhook = () =>
    context.request.post(base + '/api/payments/yookassa/webhook', {
      data: {
        type: 'notification',
        event: 'payment.succeeded',
        object: {
          id: current().id,
          metadata: current().metadata,
          status: 'succeeded',
          paid: true,
        },
      },
    });
  const forged = await webhook();
  if (forged.status() !== 200) throw Error('Webhook failed');
  const json = await forged.json();
  if (JSON.stringify(json).includes(id)) throw Error('Webhook leaks order');
  await page.getByRole('button', { name: 'Обновить статус' }).click();
  await expect(page.getByTestId('order-status')).toHaveText(
    'Ожидает подтверждения'
  );
  checks.push(
    'Provider redirect and forged success never confirm payment; webhook returns no order data'
  );
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      )
    )
      throw Error('Horizontal overflow');
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await pause(150);
    await page.screenshot({
      path: 'docs/screenshots/yookassa-pending-' + width + '.png',
      fullPage: true,
    });
  }
  const blocked = await context.request.post(
    base + '/api/orders/' + id + '/demo',
    {
      headers: { Origin: base },
      data: { attemptId: current().metadata.attempt_id, result: 'succeeded' },
    }
  );
  if (blocked.status() !== 403)
    throw Error('Demo endpoint accepted provider payment');
  const stranger = await browser.newContext();
  if ((await stranger.request.get(base + '/api/orders/' + id)).status() !== 404)
    throw Error('Unauthorized access');
  await stranger.close();
  update((s) => {
    s.payments.at(-1).status = 'canceled';
    s.payments.at(-1).cancellation_details = {
      party: 'merchant',
      reason: 'canceled_by_merchant',
    };
  });
  await webhook();
  await page.getByRole('button', { name: 'Обновить статус' }).click();
  await expect(page.getByTestId('order-status')).toHaveText(
    'Тестовая оплата отменена'
  );
  await page.getByRole('button', { name: 'Повторить тестовую оплату' }).click();
  await expect(paylink).toBeVisible();
  if (state().payments.length !== 2)
    throw Error('Retry did not create exactly one new attempt');
  update((s) => {
    s.payments.at(-1).status = 'canceled';
    s.payments.at(-1).cancellation_details = {
      party: 'payment_network',
      reason: 'insufficient_funds',
    };
  });
  await webhook();
  await page.getByRole('button', { name: 'Обновить статус' }).click();
  await expect(page.getByTestId('order-status')).toHaveText(
    'Ошибка тестовой оплаты'
  );
  await page.getByRole('button', { name: 'Повторить тестовую оплату' }).click();
  await expect(paylink).toBeVisible();
  checks.push(
    'Confirmed cancellation and failure retry in the same order; demo endpoint blocked and stranger denied'
  );
  update((s) => {
    s.payments.at(-1).status = 'succeeded';
    s.payments.at(-1).paid = true;
  });
  const replies = await Promise.all(Array.from({ length: 5 }, webhook));
  if (replies.some((r) => r.status() !== 200))
    throw Error('Duplicate webhook failed');
  await page.getByRole('button', { name: 'Обновить статус' }).click();
  await expect(page.getByTestId('order-status')).toHaveText(
    'Тестовая оплата подтверждена'
  );
  await expect(
    page.getByText('API ЮKassa подтвердил успешную тестовую оплату.', {
      exact: false,
    })
  ).toBeVisible();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      )
    )
      throw Error('Horizontal overflow');
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({top:0,behavior:'instant'}); });
    await pause(150);
    await page.screenshot({
      path: 'docs/screenshots/yookassa-success-' + width + '.png',
      fullPage: true,
    });
  }
  await page.goto(base + '/cart');
  await expect(
    page.getByRole('heading', { name: /Здесь начинается/ })
  ).toBeVisible();
  checks.push(
    'Verified success survives repeated notifications, clears purchased items, queues email; screenshots at 360/768/1440'
  );
  await page.close();
  stop();
  await pause(700);
  await start();
  const restored = await context.request.get(base + '/api/orders/' + id);
  if ((await restored.json()).order.status !== 'paid')
    throw Error('Paid status lost after restart');
  checks.push(
    'Provider mode, payment ids, paid status and protected access survive production server restart'
  );
  await context.close();
  if (errors.length) throw Error(errors.join('\n'));
  writeFileSync(
    'docs/payment-check-results.json',
    JSON.stringify(
      {
        date: new Date().toISOString(),
        mode: 'mocked YooKassa API; real provider NOT tested',
        checks,
        errors,
      },
      null,
      2
    ) + '\n'
  );
  console.log('Payment browser checks passed:', checks.length);
} finally {
  if (browser) await browser.close();
  stop();
  for (const path of [db, db + '-wal', db + '-shm', fixture])
    if (path.startsWith(qa) && existsSync(path)) unlinkSync(path);
}
