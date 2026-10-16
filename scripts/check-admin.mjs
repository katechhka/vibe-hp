import { spawn, execFileSync } from 'node:child_process';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium, expect as baseExpect } from '@playwright/test';
const expect = baseExpect.configure({ timeout: 30000 }),
  base = 'http://127.0.0.1:3006',
  qa = resolve('.qa');
mkdirSync(qa, { recursive: true });
mkdirSync('docs/screenshots', { recursive: true });
const db = resolve(qa, 'admin-' + randomUUID() + '.sqlite'),
  uploads = resolve(qa, 'admin-media-' + randomUUID());
const password = 'test-admin-password',
  salt = randomBytes(16).toString('hex'),
  hash = salt + ':' + scryptSync(password, salt, 64).toString('hex');
const env = {
  ...process.env,
  APP_URL: base,
  DATABASE_PATH: db,
  UPLOADS_PATH: uploads,
  ADMIN_PASSWORD_HASH: hash,
  PAYMENT_MODE: 'demo',
  EMAIL_MODE: 'disabled',
};
let server, browser;
const checks = [],
  errors = [];
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
      '3006',
    ],
    { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw Error('Admin test server stopped');
    try {
      if ((await fetch(base + '/api/stock')).ok) return;
    } catch {}
    await pause(500);
  }
  throw Error('Server not ready');
};
const fields = {
  name: 'Тестовая Ася',
  email: 'test@example.com',
  phone: '+7 999 123-45-67',
  city: 'Москва',
  pickupAddress: 'Условный пункт, 3',
  courierAddress: '',
  comment: 'Тестовый комментарий',
  delivery: 'pickup',
  consent: true,
  demo: true,
};
const body = (price = 290, id = 'ps-001') => ({
  requestKey: randomUUID(),
  fields,
  items: [
    {
      id,
      variant: '',
      quantity: 1,
      lots: [{ key: randomUUID(), quantity: 1 }],
    },
  ],
  expectedTotal: Math.round(price * 100) + 35000,
});
async function post(context, path, data) {
  return context.request.post(base + path, { headers: { Origin: base }, data });
}
try {
  try {
    await fetch(base);
    throw Error('Port occupied');
  } catch (e) {
    if (e.message === 'Port occupied') throw e;
  }
  await start();
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
  });
  const admin = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    buyer = await browser.newContext();
  const page = await admin.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (e.type() === 'error' && !/401|404|409/.test(e.text()))
      errors.push(e.text());
  });
  for (const endpoint of ['/api/admin/products', '/api/admin/orders'])
    if ((await buyer.request.get(base + endpoint)).status() !== 401)
      throw Error('Unauthorized API access');
  const oldRequest = body(),
    old = (await (await post(buyer, '/api/orders', oldRequest)).json()).order;
  await page.goto(base + '/admin');
  await page.waitForURL('**/admin/login');
  await page.getByLabel('Пароль', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.locator('p[role=alert]')).toHaveText('Неверный пароль.');
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL('**/admin');
  await expect(page.locator('.admin-product')).toHaveCount(12);
  checks.push(
    'Unauthorized API and page access blocked; login validates password and sets protected session'
  );
  const cookie = (await admin.cookies()).find(
    (c) => c.name === 'ps-admin-session'
  );
  if (!cookie?.httpOnly || cookie.sameSite !== 'Strict')
    throw Error('Admin cookie not protected');
  if (
    (
      await admin.request.post(base + '/api/admin/save', {
        headers: { Origin: 'https://evil.example' },
        data: {},
      })
    ).status() !== 403
  )
    throw Error('CSRF not blocked');
  const product = page
    .locator('.admin-product')
    .filter({ hasText: 'Письмо из замка' });
  await product.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Физический остаток, шт.').fill('0');
  await page.getByRole('button', { name: 'Сохранить товар' }).click();
  await expect(page.locator('p[role=alert]')).toContainText('меньше резерва');
  await page.getByLabel('Физический остаток, шт.').fill('12');
  await page.getByLabel('Цена, ₽').fill('375.50');
  await page.getByRole('button', { name: 'Сохранить товар' }).click();
  await expect(page.getByRole('status')).toContainText('Товар сохранён.');
  const original = (
    await (await buyer.request.get(base + '/api/orders/' + old.id)).json()
  ).order;
  if (original.total !== 64000) throw Error('Old order changed');
  const repeated = (await (await post(buyer, '/api/orders', oldRequest)).json())
    .order;
  if (repeated.id !== old.id) throw Error('Idempotence lost');
  const storefront = await buyer.newPage();
  await storefront.goto(base + '/products/letter');
  await expect(storefront.locator('.product-info .product-price')).toContainText('375,5');
  checks.push(
    'Editor updates live storefront price without rebuild; reserve protects stock; old order and repeated request retain snapshot'
  );
  await page.locator('.admin-editor-heading button').click();
  const current = (
    await (await admin.request.get(base + '/api/admin/products')).json()
  ).products.find((p) => p.id === 'ps-001');
  const stale = { ...current, variants: current.variants || [], price: 400 };
  const saved = await post(admin, '/api/admin/save', stale);
  if (!saved.ok()) throw Error('Save failed');
  if ((await post(admin, '/api/admin/save', stale)).status() !== 409)
    throw Error('Stale editor accepted');
  await page.getByRole('button', { name: 'Добавить товар' }).click();
  for (const [label, value] of Object.entries({
    Название: 'Новая открытка',
    'Цена, ₽': '490',
    'Физический остаток, шт.': '3',
    'Краткое описание': 'Небольшая авторская история.',
    'Подробное описание':
      'Новая открытка с собственной иллюстрацией мастерской.',
    Материалы: 'Плотная матовая бумага',
    Размеры: '10 × 15 см',
    Уход: 'Беречь от воды.',
    'Описание изображений для незрячих': 'Авторская открытка на светлом фоне',
  }))
    await page.getByLabel(label, { exact: true }).fill(value);
  await expect(page.locator('.admin-editor input[readonly]')).toHaveValue('novaya-otkrytka');
  await expect(page.locator('.admin-editor [required]')).toHaveCount(3);
  await page.locator('.admin-editor > button[type=button]').click();
  await expect(page.locator('.admin-list')).toBeVisible();
  await page.locator('.admin-product button').first().click();
  await page.locator('.admin-tabs button').first().click();
  await expect(page.locator('.admin-list')).toBeVisible();
  await page.locator('.admin-toolbar .button').click();
  await page.locator('.admin-editor [required]').nth(0).fill('Новая открытка');
  await page.locator('.admin-editor [required]').nth(1).fill('490');
  await page.locator('.admin-editor [required]').nth(2).fill('Handmade gift');
  await page.locator('.admin-editor input[type=number]').nth(1).fill('3');
  await page.locator('.admin-editor > button[type=submit], .admin-editor > button:not([type])').click();
  await expect(page.locator('.admin-image-grid>div')).toHaveCount(1);
  checks.push('Editor returns via button and products tab; slug is generated; minimal product saves with placeholder');
  const file = page.getByLabel(/Загрузить JPEG/);
  await file.setInputFiles('public/images/letter.webp');
  await expect(page.locator('.admin-image-grid img').first()).toHaveAttribute('src', /media/);
  await expect(file).toBeEnabled();
  await expect(page.locator('.admin-image-grid>div')).toHaveCount(1);
  await file.setInputFiles('public/images/letter-detail.webp');
  await expect(page.locator('.admin-image-grid>div')).toHaveCount(2);
  await page.getByRole('button', { name: 'Сохранить товар' }).click();
  await expect(page.getByRole('status')).toContainText('Товар сохранён.');
  if (
    (
      await (await buyer.request.get(base + '/api/catalog')).json()
    ).products.some((p) => p.slug === 'novaya-otkrytka')
  )
    throw Error('Draft visible publicly');
  await page.getByLabel('Показывать в магазине').check();
  await page.getByRole('button', { name: 'Сохранить товар' }).click();
  await expect(page.getByRole('status')).toContainText('Товар сохранён.');
  await storefront.goto(base + '/products/novaya-otkrytka');
  await expect(
    storefront.getByRole('heading', { name: 'Новая открытка', exact: true })
  ).toBeVisible();
  const newProduct = (
    await (await buyer.request.get(base + '/api/catalog')).json()
  ).products.find((p) => p.slug === 'novaya-otkrytka');
  if ((await buyer.request.get(base + newProduct.gallery[0])).status() !== 200)
    throw Error('Uploaded image not served');
  const order = (
    await (await post(buyer, '/api/orders', body(490, newProduct.id))).json()
  ).order;
  if (order.total !== 84000) throw Error('New product cannot be ordered');
  const paid = await post(buyer, '/api/orders/' + order.id + '/demo', {
    attemptId: order.activeAttempt,
    result: 'succeeded',
  });
  if (!paid.ok()) throw Error('New product cannot be paid');
  const detail = (
    await (
      await admin.request.get(base + '/api/admin/orders?id=' + order.id)
    ).json()
  ).order;
  if (detail.customer.email !== fields.email || detail.status !== 'paid')
    throw Error('Admin order detail incomplete');
  const publicOrder = (
    await (await buyer.request.get(base + '/api/orders/' + order.id)).json()
  ).order;
  if (
    publicOrder.customer ||
    JSON.stringify(publicOrder).includes(fields.email)
  )
    throw Error('Public PII leak');
  checks.push(
    'New draft, two optimized uploads, publication, dynamic product URL and purchase work; orders are private'
  );
  await page.locator('.admin-editor-heading button').click();
  await page.getByRole('button', { name: 'Обновить список' }).click();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth
      )
    )
      throw Error('Admin overflow');
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await pause(150);
    await page.screenshot({
      path: 'docs/screenshots/admin-products-' + width + '.png',
      fullPage: true,
    });
  }
  await page.getByRole('tab', { name: 'Заказы', exact: true }).click();
  await page
    .locator('.admin-order')
    .first()
    .getByRole('button', { name: 'Посмотреть' })
    .click();
  await expect(
    page.getByText('Тестовая Ася · test@example.com', { exact: false })
  ).toBeVisible();
  await page.screenshot({
    path: 'docs/screenshots/admin-order.png',
    fullPage: true,
  });
  await page.getByRole('tab', { name: 'Доступ', exact: true }).click();
  await page.getByLabel('Текущий пароль').fill(password);
  await page
    .getByLabel('Новый пароль — минимум 12 символов')
    .fill('new-test-admin-password');
  await page
    .getByRole('button', { name: 'Сменить пароль', exact: true })
    .click();
  await page.waitForURL('**/admin/login');
  if ((await admin.request.get(base + '/api/admin/products')).status() !== 401)
    throw Error('Old session remains valid');
  await page
    .getByLabel('Пароль', { exact: true })
    .fill('new-test-admin-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.waitForURL('**/admin');
  checks.push(
    'Admin responsive at 360/768/1440; order detail works; password change revokes session and new login works'
  );
  await page.close();
  await storefront.close();
  stop();
  await pause(700);
  await start();
  const restored = (
    await (await admin.request.get(base + '/api/admin/products')).json()
  ).products.find((p) => p.slug === 'novaya-otkrytka');
  if (restored.stock !== 2) throw Error('Catalog/stock lost after restart');
  if ((await buyer.request.get(base + restored.gallery[0])).status() !== 200)
    throw Error('Upload lost after restart');
  const oldLogin = await post(buyer, '/api/admin/login', { password });
  if (oldLogin.status() !== 401) throw Error('Old password restored from env');
  checks.push(
    'Catalog, uploads, paid stock and changed password survive production restart; env seed does not reset password'
  );
  await admin.close();
  await buyer.close();
  if (errors.length) throw Error(errors.join('\n'));
  writeFileSync(
    'docs/admin-check-results.json',
    JSON.stringify(
      { date: new Date().toISOString(), checks, errors },
      null,
      2
    ) + '\n'
  );
  console.log(
    'PASS:',
    checks.length,
    'admin browser groups; isolated data, no emails or external payments'
  );
} finally {
  if (browser) await browser.close();
  stop();
  for (const p of [db, db + '-wal', db + '-shm'])
    if (p.startsWith(qa) && existsSync(p)) unlinkSync(p);
  if (uploads.startsWith(qa) && existsSync(uploads))
    rmSync(uploads, { recursive: true, force: true });
}
