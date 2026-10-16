import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { PgShopStore, type shopTransaction } from './pg-store';
import { products } from '../data/catalog';
import { passwordHash } from './admin-auth';
import { ShopError } from './store';
import { rows, execute } from './app-store';
import { Payments } from './payments';
import type { YooKassa, Payment } from './yookassa';
import { randomUUID } from 'node:crypto';
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
function request(id = 'ps-001', price = 290) {
  const key = randomUUID();
  return {
    requestKey: key,
    items: [
      {
        id,
        variant: '',
        quantity: 1,
        lots: [{ key: randomUUID(), quantity: 1 }],
      },
    ],
    fields: { ...fields },
    expectedTotal: (price + 350) * 100,
  };
}
async function fixture(
  fn: (store: PgShopStore, tick: (ms: number) => void) => Promise<void>
) {
  const db = new PGlite();
  let now = Date.now();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  await db.exec(readFileSync('deploy/supabase-schema.sql', 'utf8'));
  for (const p of products.slice(0, 2)) {
    await db.query('INSERT INTO shop.inventory VALUES($1,$2)', [p.id, 2]);
    await db.query('INSERT INTO shop.inventory_versions VALUES($1,1)', [p.id]);
    await db.query('INSERT INTO shop.catalog(id,slug,data) VALUES($1,$2,$3)', [
      p.id,
      p.slug,
      JSON.stringify({ ...p, gallery: ['/images/letter.webp'] }),
    ]);
  }
  await db.query('INSERT INTO shop.admin_account VALUES(1,$1)', [
    passwordHash('test-admin-password'),
  ]);
  const transaction: typeof shopTransaction = async (action) =>
    db.transaction(async (tx) => {
      await tx.exec('SET LOCAL search_path TO shop,pg_catalog');
      const client = {
        query: async (sql: string, params?: unknown[]) => {
          const r = await tx.query(sql, params);
          return { rows: r.rows, rowCount: r.affectedRows || r.rows.length };
        },
      } as unknown as PoolClient;
      return action(client);
    });
  const store = new PgShopStore(() => now, transaction);
  try {
    await fn(store, (ms) => {
      now += ms;
    });
  } finally {
    await db.close();
  }
}
test('PostgreSQL: order snapshot, foreign access, tampered totals and global creation idempotence', () =>
  fixture(async (s) => {
    const req = request(),
      order = await s.create(req, 'owner');
    assert.equal(order.total, 64000);
    await assert.rejects(
      s.create({ ...req, expectedTotal: 1, requestKey: randomUUID() }, 'owner'),
      ShopError
    );
    await assert.rejects(s.get(order.id, 'stranger'), ShopError);
    await assert.rejects(s.create(req, 'stranger'), ShopError);
    const p = (await s.adminProducts())[0];
    await s.saveProduct({ ...p, price: 350 });
    assert.equal((await s.create(req, 'owner')).id, order.id);
    assert.equal((await s.get(order.id, 'owner')).total, 64000);
    assert.equal(
      JSON.stringify(await s.get(order.id, 'owner')).includes(
        'test@example.com'
      ),
      false
    );
  }));
test('PostgreSQL: concurrent reservations, cancellation and retry cannot oversell', () =>
  fixture(async (s) => {
    const a = await s.create(request(), 'a');
    const b = await s.create(request(), 'b');
    const results = await Promise.allSettled([
      s.create(request(), 'c'),
      s.create(request(), 'd'),
    ]);
    assert.ok(results.every((r) => r.status === 'rejected'));
    await s.resolve(a.id, 'a', a.activeAttempt, 'canceled');
    assert.equal((await s.stock())['ps-001'], 1);
    const retry = await s.retry(a.id, 'a', randomUUID());
    assert.equal(retry.id, a.id);
    await s.resolve(b.id, 'b', b.activeAttempt, 'succeeded');
    await s.resolve(retry.id, 'a', retry.activeAttempt, 'succeeded');
    assert.equal((await s.stock())['ps-001'], 0);
    assert.equal(
      (await rows<{ n: string }>(s, 'SELECT count(*) AS n FROM mail_outbox'))[0]
        .n,
      2
    );
  }));
test('PostgreSQL: payment terminal states are monotonic; stale attempts and double notifications are safe', () =>
  fixture(async (s) => {
    const o = await s.create(request(), 'owner');
    await s.resolve(o.id, 'owner', o.activeAttempt, 'failed');
    const retry = await s.retry(o.id, 'owner', randomUUID());
    await assert.rejects(
      s.resolve(o.id, 'owner', o.activeAttempt, 'succeeded'),
      ShopError
    );
    await s.resolve(o.id, 'owner', retry.activeAttempt, 'succeeded');
    await s.resolve(o.id, 'owner', retry.activeAttempt, 'succeeded');
    assert.equal((await s.catalog())[0].stock, 1);
    await assert.rejects(
      s.resolve(o.id, 'owner', retry.activeAttempt, 'canceled'),
      ShopError
    );
  }));
test('PostgreSQL: expiry releases demo reserve but never expires unknown external test payment', () =>
  fixture(async (s, tick) => {
    const demo = await s.create(request(), 'demo');
    const external = await s.create(request(), 'provider', 'yookassa_test');
    tick(31 * 60000);
    assert.equal((await s.get(demo.id, 'demo')).status, 'expired');
    assert.equal((await s.get(external.id, 'provider')).status, 'pending');
    await assert.rejects(
      s.resolve(external.id, 'provider', external.activeAttempt, 'succeeded'),
      ShopError
    );
    assert.equal(
      (
        await s.resolve(
          external.id,
          'provider',
          external.activeAttempt,
          'succeeded',
          true
        )
      ).status,
      'paid'
    );
  }));
test('PostgreSQL: editor revisions, reserved stock, minimal product and hidden catalog', () =>
  fixture(async (s) => {
    const o = await s.create(request(), 'owner');
    const p = (await s.adminProducts())[0];
    await assert.rejects(s.saveProduct({ ...p, stock: 0 }), ShopError);
    await s.resolve(o.id, 'owner', o.activeAttempt, 'succeeded');
    await assert.rejects(s.saveProduct({ ...p, price: 500 }), ShopError);
    const created = await s.saveProduct({
      name: 'Лунный свет',
      price: 450,
      short: 'Авторская вещь',
    });
    assert.equal(created.slug, 'lunnyy-svet');
    assert.deepEqual(created.gallery, ['/images/product-placeholder.webp']);
    assert.equal(
      (await s.catalog()).some((p) => p.id === created.id),
      false
    );
    await s.saveProduct({ ...created, visible: true });
    assert.equal(
      (await s.catalog()).some((p) => p.id === created.id),
      true
    );
  }));
test('PostgreSQL: password change revokes sessions; shared rate limit and durable email lease', () =>
  fixture(async (s, tick) => {
    const token = await s.login('test-admin-password');
    assert.equal(await s.authenticated(token), true);
    await s.changePassword('test-admin-password', 'changed-admin-password');
    assert.equal(await s.authenticated(token), false);
    for (let i = 0; i < 10; i++)
      assert.equal(await s.login('wrong-password'), null);
    await assert.rejects(s.login('changed-admin-password'), ShopError);
    tick(16 * 60000);
    assert.ok(await s.login('changed-admin-password'));
    const o = await s.create(request(), 'owner');
    await s.resolve(o.id, 'owner', o.activeAttempt, 'succeeded');
    const [a, b] = await Promise.all([
      s.claimMail(o.id, 'sender@example.com'),
      s.claimMail(o.id, 'sender@example.com'),
    ]);
    assert.equal([a, b].filter(Boolean).length, 1);
    const leased = a || b!;
    await s.finishMail(leased, 'receipt-test-id', null);
    assert.equal((await s.get(o.id, 'owner')).emailStatus, 'sent');
    assert.equal(await s.claimMail(o.id, 'sender@example.com'), null);
  }));
test('PostgreSQL: provider adapter freezes request and verifies success through API using same order', () =>
  fixture(async (s) => {
    process.env.YOOKASSA_SHOP_ID = '123456';
    process.env.YOOKASSA_SECRET_KEY = 'test_secret';
    const o = await s.create(request(), 'owner', 'yookassa_test');
    const payment: Payment = {
      id: randomUUID(),
      status: 'pending',
      paid: false,
      test: true,
      amount: { value: '640.00', currency: 'RUB' },
      recipient: { account_id: '123456' },
      metadata: { order_id: o.id, attempt_id: o.activeAttempt! },
      confirmation: {
        type:'redirect',
        confirmation_url: 'https://yoomoney.ru/checkout/payments/v2/contract',
      },
    };
    const fake = {
      create: async () => ({ ...payment }),
      get: async () => ({ ...payment }),
    } as unknown as YooKassa;
    const payments = new Payments(s, fake);
    assert.equal((await payments.start(o.id, 'owner')).status, 'pending');
    payment.status = 'succeeded';
    payment.paid = true;
    const paid = await payments.webhook({
      type: 'notification',
      event: 'payment.succeeded',
      object: { id: payment.id },
    });
    assert.equal(paid?.status, 'paid');
    await payments.webhook({
      type: 'notification',
      event: 'payment.succeeded',
      object: { id: payment.id },
    });
    assert.equal((await s.catalog())[0].stock, 1);
  }));
