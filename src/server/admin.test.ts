import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ShopStore, ShopError } from './store';
import { adminProducts, saveProduct } from './catalog-store';
import {
  passwordHash,
  login,
  authenticated,
  logout,
  changePassword,
} from './admin-auth';
import { initialCheckout } from '../lib/checkout';
const request = () => ({
  requestKey: randomUUID(),
  fields: {
    ...initialCheckout,
    name: 'Тестовая Ася',
    email: 'test@example.com',
    phone: '+7 999 123-45-67',
    city: 'Москва',
    pickupAddress: 'Условный пункт, 3',
    consent: true,
    demo: true,
  },
  items: [
    {
      id: 'ps-001',
      variant: '',
      quantity: 1,
      lots: [{ key: randomUUID(), quantity: 1 }],
    },
  ],
  expectedTotal: 64000,
});
const edit = (s: ShopStore, id = 'ps-001') => ({
  ...adminProducts(s).find((p) => p.id === id)!,
  variants: adminProducts(s).find((p) => p.id === id)!.variants || [],
});
function fixture(fn: (s: ShopStore) => void) {
  const s = new ShopStore(':memory:');
  try {
    fn(s);
  } finally {
    s.close();
  }
}
test('Admin password hash, random session, logout and expiration', () =>
  fixture((s) => {
    const hash = passwordHash('test-admin-password');
    assert.ok(!hash.includes('test-admin-password'));
    s.native
      .prepare('INSERT OR REPLACE INTO admin_account VALUES(1,?)')
      .run(hash);
    assert.equal(login(s.native, 'wrong'), null);
    const token = login(s.native, 'test-admin-password', 1000)!;
    assert.ok(authenticated(s.native, token, 2000));
    assert.equal(authenticated(s.native, token, 1000 + 8 * 60 * 60_000), false);
    assert.equal(authenticated(s.native, randomUUID()), false);
    logout(s.native, token);
    assert.equal(authenticated(s.native, token, 2000), false);
  }));
test('Failed login limit persists and cannot be bypassed by fresh cookies', () =>
  fixture((s) => {
    s.native
      .prepare('INSERT OR REPLACE INTO admin_account VALUES(1,?)')
      .run(passwordHash('test-admin-password'));
    for (let i = 0; i < 10; i++)
      assert.equal(login(s.native, 'wrong', 1000), null);
    assert.throws(
      () => login(s.native, 'test-admin-password', 1001),
      (e: any) => e.status === 429
    );
    assert.ok(login(s.native, 'test-admin-password', 1000 + 15 * 60_000));
  }));
test('Password change revokes every session and invalid old password cannot change it', () =>
  fixture((s) => {
    s.native
      .prepare('INSERT OR REPLACE INTO admin_account VALUES(1,?)')
      .run(passwordHash('test-admin-password'));
    const a = login(s.native, 'test-admin-password')!,
      b = login(s.native, 'test-admin-password')!;
    assert.throws(
      () => changePassword(s.native, 'wrong', 'new-admin-password'),
      ShopError
    );
    assert.ok(authenticated(s.native, a));
    changePassword(s.native, 'test-admin-password', 'new-admin-password');
    assert.equal(authenticated(s.native, a), false);
    assert.equal(authenticated(s.native, b), false);
    assert.equal(login(s.native, 'test-admin-password'), null);
    assert.ok(login(s.native, 'new-admin-password'));
    assert.throws(() => passwordHash('short'), ShopError);
  }));
test('Prices update authoritatively in cents; old order snapshot and repeated request survive changes', () =>
  fixture((s) => {
    const r = request(),
      old = s.create(r, 'owner');
    saveProduct(s, { ...edit(s), price: 300.29, name: 'Обновлённое письмо' });
    assert.equal(s.catalog().find((p) => p.id === 'ps-001')!.price, 300.29);
    assert.equal(s.create(r, 'owner').id, old.id);
    assert.equal(
      s.create({ ...r, expectedTotal: 99999 }, 'owner').total,
      old.total
    );
    assert.equal(s.get(old.id, 'owner').items[0].unitPrice, 29000);
    assert.throws(
      () => s.create({ ...r, requestKey: randomUUID() }, 'owner'),
      ShopError
    );
    const fresh = s.create(
      { ...r, requestKey: randomUUID(), expectedTotal: 65029 },
      'owner'
    );
    assert.equal(fresh.items[0].unitPrice, 30029);
    assert.equal(fresh.items[0].name, 'Обновлённое письмо');
  }));
test('Stock cannot drop below live reserve; optimistic edits reject stale revision', () =>
  fixture((s) => {
    s.create(request(), 'owner');
    const p = edit(s);
    assert.equal(p.reserved, 1);
    assert.equal(p.available, 11);
    assert.throws(
      () => saveProduct(s, { ...p, stock: 0 }),
      (e: any) => e.status === 409
    );
    saveProduct(s, { ...p, stock: 2 });
    assert.equal(s.stock()['ps-001'], 1);
    assert.throws(
      () => saveProduct(s, { ...p, price: 999 }),
      (e: any) => e.status === 409
    );
  }));
test('A payment after opening editor prevents resurrecting sold stock', () =>
  fixture((s) => {
    const o = s.create(request(), 'owner'),
      stale = edit(s);
    s.resolve(o.id, 'owner', o.activeAttempt, 'succeeded');
    assert.throws(
      () => saveProduct(s, { ...stale, price: 299 }),
      (e: any) => e.status === 409
    );
    assert.equal(edit(s).stock, 11);
    assert.equal(edit(s).reserved, 0);
    saveProduct(s, { ...edit(s), price: 299 });
    assert.equal(edit(s).stock, 11);
  }));
test('Hiding product blocks new orders but keeps protected old order payable and idempotent', () =>
  fixture((s) => {
    const r = request(),
      o = s.create(r, 'owner');
    saveProduct(s, { ...edit(s), visible: false });
    assert.equal(
      s.catalog().some((p) => p.id === 'ps-001'),
      false
    );
    assert.throws(
      () => s.create({ ...r, requestKey: randomUUID() }, 'owner'),
      ShopError
    );
    s.resolve(o.id, 'owner', o.activeAttempt, 'succeeded');
    assert.equal(s.create(r, 'owner').status, 'paid');
    assert.equal(s.get(o.id, 'owner').items[0].name, 'Письмо из замка');
  }));
test('New draft product, publication and validation are permanent operations', () =>
  fixture((s) => {
    const p = edit(s);
    const { id, revision, stockRevision, ...draft } = p;
    const created = saveProduct(s, {
      ...draft,
      slug: 'new-letter',
      name: 'Новое письмо',
      visible: false,
      stock: 3,
    });
    assert.ok(created.id !== p.id);
    assert.equal(
      s.catalog().some((p) => p.id === created.id),
      false
    );
    const visible = saveProduct(s, { ...created, variants: [], visible: true });
    assert.equal(
      s.catalog().find((p) => p.id === visible.id)?.name,
      'Новое письмо'
    );
    const req = request();
    req.items[0].id = visible.id;
    s.create(req, 'owner');
    for (const patch of [
      { price: -1 },
      { price: 1.001 },
      { stock: -1 },
      { gallery: ['https://evil.example/image'] },
      { slug: 'changed-address' },
      { variants: ['a', 'a'] },
    ])
      assert.throws(
        () => saveProduct(s, { ...edit(s, visible.id), ...patch }),
        ShopError
      );
  }));
test('Catalog and changed admin password survive reopen and initial seed never overwrites them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-admin-')),
    path = join(dir, 'shop.sqlite');
  let s = new ShopStore(path);
  try {
    saveProduct(s, { ...edit(s), price: 777, stock: 4 });
    s.native
      .prepare('INSERT OR REPLACE INTO admin_account VALUES(1,?)')
      .run(passwordHash('first-admin-password'));
    changePassword(s.native, 'first-admin-password', 'second-admin-password');
    s.close();
    s = new ShopStore(path);
    assert.equal(edit(s).price, 777);
    assert.equal(edit(s).stock, 4);
    assert.ok(login(s.native, 'second-admin-password'));
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Minimal product uses generated address and placeholder; only name, price and short are required', () =>
  fixture((s) => {
    const minimal = { name: 'Лунный свет', price: 450, short: 'Handmade gift' };
    const p = saveProduct(s, minimal);
    assert.equal(p.slug, 'lunnyy-svet');
    assert.equal(p.stock, 0);
    assert.deepEqual(p.gallery, ['/images/product-placeholder.webp']);
    assert.equal(p.description, '');
    assert.equal(p.materials, '');
    assert.ok(p.alt);
    assert.equal(saveProduct(s, minimal).slug, 'lunnyy-svet-2');
    for (const patch of [{ name: '' }, { short: '' }, { price: 0 }])
      assert.throws(() => saveProduct(s, { ...minimal, ...patch }), ShopError);
    const photo = saveProduct(s, {
      ...p,
      gallery: ['/images/letter.webp'],
      variants: [],
    });
    assert.deepEqual(photo.gallery, ['/images/letter.webp']);
  }));
