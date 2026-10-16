import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ShopStore, ShopError, parseOrder } from './store';
import { initialCheckout } from '../lib/checkout';
const fields = {
  ...initialCheckout,
  name: 'Тестовая Ася',
  email: 'test@example.com',
  phone: '+7 999 123-45-67',
  city: 'Москва',
  pickupAddress: 'Тестовый пункт, 3',
  consent: true,
  demo: true,
};
const request = (quantity = 1, id = 'ps-008') => ({
  requestKey: randomUUID(),
  fields: { ...fields },
  items: [
    {
      id,
      variant: id === 'ps-008' ? 'В точку' : '',
      quantity,
      lots: [{ key: randomUUID(), quantity }],
    },
  ],
  expectedTotal: (id === 'ps-008' ? 169000 : 29000) * quantity + 35000,
});
const fixture = (fn: (s: ShopStore) => void) => {
  const s = new ShopStore(':memory:');
  try {
    fn(s);
  } finally {
    s.close();
  }
};
test('Authoritative prices and shipping are calculated in kopecks', () => {
  const r = parseOrder(request(2));
  assert.equal(r.subtotal, 338000);
  assert.equal(r.total, 373000);
});
test('Reject price injection, wrong total, unknown variant, empty and unavailable cart', () => {
  for (const mutate of [
    (r: any) => (r.items[0].price = 1),
    (r: any) => (r.expectedTotal = 1),
    (r: any) => (r.items[0].variant = 'подделка'),
    (r: any) => (r.items = []),
    (r: any) => {
      r.items[0].id = 'ps-010';
      r.items[0].variant = '';
    },
  ]) {
    const r = request();
    mutate(r);
    assert.throws(() => parseOrder(r), ShopError);
  }
});
test('Server rejects wrong field types, delivery, missing consent and invalid phone', () => {
  for (const [key, value] of [
    ['name', 42],
    ['delivery', 'free'],
    ['consent', false],
    ['demo', false],
    ['phone', 'abcdef1234567890'],
    ['comment', 'x'.repeat(1001)],
  ]) {
    const r = request();
    (r.fields as any)[key as string] = value;
    assert.throws(() => parseOrder(r), ShopError);
  }
});
test('Variants share stock; duplicates and unsafe quantities are rejected', () => {
  const r = request(3);
  r.items.push({
    ...r.items[0],
    variant: 'Чистые страницы',
    lots: [{ key: randomUUID(), quantity: 3 }],
  });
  r.expectedTotal = 1049000;
  assert.throws(() => parseOrder(r), ShopError);
  const duplicate = request();
  duplicate.items.push({ ...duplicate.items[0] });
  assert.throws(() => parseOrder(duplicate), ShopError);
  for (const qty of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => parseOrder(request(qty)), ShopError);
});
test('Create request is durable and idempotent; changed payload is rejected', () =>
  fixture((s) => {
    const r = request();
    const a = s.create(r, 'owner');
    const b = s.create(r, 'owner');
    assert.equal(a.id, b.id);
    assert.equal(a.activeAttempt, b.activeAttempt);
    r.fields.name = 'Другой тест';
    assert.throws(
      () => s.create(r, 'owner'),
      (e: any) => e.status === 409
    );
    assert.equal(
      (
        s.native.prepare('SELECT count(*) AS n FROM orders').get() as {
          n: number;
        }
      ).n,
      1
    );
  }));
test('Random URL does not authorize a different owner; public view omits personal data', () =>
  fixture((s) => {
    const a = s.create(request(), 'owner');
    assert.throws(
      () => s.get(a.id, 'stranger'),
      (e: any) => e.status === 404
    );
    const view = JSON.stringify(s.get(a.id, 'owner'));
    assert.ok(!view.includes(fields.email));
    assert.ok(!view.includes(fields.phone));
    assert.ok(!('customer' in a));
  }));
test('Success decrements inventory exactly once and cannot be downgraded', () =>
  fixture((s) => {
    const a = s.create(request(2), 'owner');
    const b = s.resolve(a.id, 'owner', a.activeAttempt, 'succeeded');
    assert.equal(b.status, 'paid');
    s.resolve(a.id, 'owner', a.activeAttempt, 'succeeded');
    assert.equal(
      (
        s.native
          .prepare("SELECT remaining FROM inventory WHERE id='ps-008'")
          .get() as any
      ).remaining,
      3
    );
    assert.throws(
      () => s.resolve(a.id, 'owner', a.activeAttempt, 'canceled'),
      (e: any) => e.status === 409
    );
    assert.equal(s.retry(a.id, 'owner', randomUUID()).status, 'paid');
  }));
test('Error, cancel and retry keep the order; old attempt cannot mark new attempt paid', () =>
  fixture((s) => {
    const a = s.create(request(), 'owner');
    assert.equal(
      s.resolve(a.id, 'owner', a.activeAttempt, 'failed').status,
      'failed'
    );
    const key = randomUUID();
    const b = s.retry(a.id, 'owner', key);
    assert.equal(b.id, a.id);
    assert.notEqual(b.activeAttempt, a.activeAttempt);
    assert.equal(s.retry(a.id, 'owner', key).activeAttempt, b.activeAttempt);
    assert.throws(
      () => s.resolve(a.id, 'owner', a.activeAttempt, 'succeeded'),
      ShopError
    );
    assert.equal(
      s.resolve(a.id, 'owner', b.activeAttempt, 'canceled').status,
      'canceled'
    );
    assert.equal(
      (
        s.native
          .prepare("SELECT remaining FROM inventory WHERE id='ps-008'")
          .get() as any
      ).remaining,
      5
    );
    const c = s.retry(a.id, 'owner', randomUUID());
    assert.equal(
      s.resolve(a.id, 'owner', c.activeAttempt, 'succeeded').status,
      'paid'
    );
  }));
test('Concurrent reservations prevent overselling and release on cancel', () =>
  fixture((s) => {
    const a = s.create(request(4), 'first');
    assert.throws(
      () => s.create(request(2), 'second'),
      (e: any) => e.status === 409
    );
    s.resolve(a.id, 'first', a.activeAttempt, 'canceled');
    assert.equal(s.create(request(5), 'second').status, 'pending');
    assert.throws(
      () => s.retry(a.id, 'first', randomUUID()),
      (e: any) => e.status === 409
    );
  }));
test('Reservation expiry cancels the old attempt; retry rechecks availability', () => {
  let now = Date.now();
  const s = new ShopStore(':memory:', () => now);
  try {
    const a = s.create(request(5), 'first');
    now += 31 * 60_000;
    assert.equal(s.get(a.id, 'first').status, 'expired');
    assert.throws(
      () => s.resolve(a.id, 'first', a.activeAttempt, 'succeeded'),
      ShopError
    );
    const b = s.create(request(5), 'second');
    assert.throws(() => s.retry(a.id, 'first', randomUUID()), ShopError);
    s.resolve(b.id, 'second', b.activeAttempt, 'canceled');
    assert.equal(s.retry(a.id, 'first', randomUUID()).status, 'pending');
  } finally {
    s.close();
  }
});
test('Paid status and customer snapshot survive closing and reopening SQLite', () => {
  const dir = mkdtempSync(join(process.cwd(), '.qa', 'database-'));
  const path = join(dir, 'test.sqlite');
  let s = new ShopStore(path);
  try {
    const r = request();
    const a = s.create(r, 'owner');
    s.resolve(a.id, 'owner', a.activeAttempt, 'succeeded');
    s.close();
    s = new ShopStore(path);
    assert.equal(s.get(a.id, 'owner').status, 'paid');
    assert.equal(s.create(r, 'owner').id, a.id);
    assert.equal(
      (
        s.native
          .prepare("SELECT remaining FROM inventory WHERE id='ps-008'")
          .get() as any
      ).remaining,
      4
    );
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test('Failed creation is atomic and does not leave orders or attempts', () =>
  fixture((s) => {
    s.create(request(5), 'owner');
    assert.throws(() => s.create(request(1), 'other'), ShopError);
    assert.equal(
      (s.native.prepare('SELECT count(*) AS n FROM orders').get() as any).n,
      1
    );
    assert.equal(
      (s.native.prepare('SELECT count(*) AS n FROM attempts').get() as any).n,
      1
    );
  }));

test('A reused creation key from another owner cannot create a duplicate or expose the order', () =>
  fixture((s) => {
    const r = request();
    s.create(r, 'first');
    assert.throws(
      () => s.create(r, 'second'),
      (e: any) => e.status === 409
    );
    assert.equal(
      (s.native.prepare('SELECT count(*) AS n FROM orders').get() as any).n,
      1
    );
  }));
test('Availability respects reservations, releases them on failure, and persists paid deductions', () =>
  fixture((s) => {
    const a = s.create(request(2), 'first');
    assert.equal(s.stock()['ps-008'], 3);
    assert.equal(s.stock('first')['ps-008'], 5);
    s.resolve(a.id, 'first', a.activeAttempt, 'failed');
    assert.equal(s.stock()['ps-008'], 5);
    const b = s.retry(a.id, 'first', crypto.randomUUID());
    s.resolve(a.id, 'first', b.activeAttempt, 'succeeded');
    assert.equal(s.stock()['ps-008'], 3);
  }));
