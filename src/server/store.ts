import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { and, eq, lt } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { products, deliveryOptions, type Product } from '../data/catalog';
import {
  validateCheckout,
  fieldLimits,
  type CheckoutFields,
  type CheckoutErrors,
} from '../lib/checkout';
import { validVariant } from '../lib/cart';
import type { OrderLine, PublicOrder, AttemptStatus } from '../lib/order-types';
import { orders, attempts, inventory } from './schema';
import { migratePayments } from './payment-storage';
import { migrateMail, enqueueReceipt, receiptStatus } from './mail-queue';

import { migrateAdmin } from './admin-auth';
import { migrateCatalog, catalog } from './catalog-store';
export class ShopError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields?: CheckoutErrors
  ) {
    super(message);
  }
}
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const keyPattern = /^[a-zA-Z0-9_-]{20,80}$/;
export function validKey(value: unknown): value is string {
  return typeof value === 'string' && keyPattern.test(value);
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export function parseOrder(
  value: unknown,
  currentProducts: Product[] = products
) {
  if (
    !record(value) ||
    !validKey(value.requestKey) ||
    !record(value.fields) ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > 24
  )
    throw new ShopError(400, 'Проверьте состав заказа и повторите попытку.');
  const raw = value.fields;
  const fields = {} as CheckoutFields;
  for (const key of Object.keys(fieldLimits) as (keyof typeof fieldLimits)[]) {
    if (typeof raw[key] !== 'string')
      throw new ShopError(400, 'Проверьте поля формы.', {
        [key]: 'Введите текстовое значение.',
      });
    fields[key] = raw[key] as string;
  }
  if (raw.delivery !== 'pickup' && raw.delivery !== 'courier')
    throw new ShopError(400, 'Выберите способ доставки.', {
      delivery: 'Выберите способ доставки.',
    });
  fields.delivery = raw.delivery;
  fields.consent = raw.consent === true;
  fields.demo = raw.demo === true;
  const errors = validateCheckout(fields);
  if (Object.keys(errors).length)
    throw new ShopError(400, 'Проверьте выделенные поля.', errors);
  for (const key of Object.keys(fieldLimits) as (keyof typeof fieldLimits)[])
    fields[key] = fields[key].trim();
  // Store only the address needed for this delivery.
  if (fields.delivery === 'pickup') fields.courierAddress = '';
  else fields.pickupAddress = '';
  const seen = new Set<string>();
  const lotKeys = new Set<string>();
  const totals = new Map<string, number>();
  const lines: OrderLine[] = value.items.map((item: unknown) => {
    if (
      !record(item) ||
      Object.keys(item).some(
        (k) => !['id', 'variant', 'quantity', 'lots'].includes(k)
      ) ||
      typeof item.id !== 'string' ||
      typeof item.variant !== 'string' ||
      !Number.isSafeInteger(item.quantity) ||
      (item.quantity as number) < 1
    )
      throw new ShopError(400, 'Некорректная позиция заказа.');
    const product = currentProducts.find((p) => p.id === item.id);
    if (!product || !validVariant(product.id, item.variant, currentProducts))
      throw new ShopError(400, 'Товар или вариант больше недоступен.');
    const signature = item.id + '\0' + item.variant;
    if (seen.has(signature))
      throw new ShopError(
        400,
        'Повторяющиеся позиции заказа. Обновите корзину.'
      );
    seen.add(signature);
    const quantity = item.quantity as number;
    totals.set(item.id, (totals.get(item.id) || 0) + quantity);
    if ((totals.get(item.id) || 0) > product.stock)
      throw new ShopError(
        409,
        'Недостаточно товара «' +
          product.name +
          '». Измените количество в корзине.'
      );
    if (
      !Array.isArray(item.lots) ||
      item.lots.length < 1 ||
      item.lots.length > 100
    )
      throw new ShopError(400, 'Обновите корзину перед оформлением.');
    const lots = item.lots.map((lot: unknown) => {
      if (
        !record(lot) ||
        !validKey(lot.key) ||
        lotKeys.has(lot.key) ||
        !Number.isSafeInteger(lot.quantity) ||
        (lot.quantity as number) < 1
      )
        throw new ShopError(400, 'Некорректные данные корзины.');
      lotKeys.add(lot.key);
      return { key: lot.key, quantity: lot.quantity as number };
    });
    if (lots.reduce((s, l) => s + l.quantity, 0) !== quantity)
      throw new ShopError(
        400,
        'Количество в корзине изменилось. Повторите оформление.'
      );
    return {
      id: product.id,
      variant: item.variant,
      quantity,
      name: product.name,
      slug: product.slug,
      image: product.image,
      unitPrice: Math.round(product.price * 100),
      lots,
    };
  });
  lines.sort((a, b) => (a.id + a.variant).localeCompare(b.id + b.variant));
  const delivery = deliveryOptions.find((o) => o.id === fields.delivery)!;
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0),
    shipping = delivery.price * 100;
  if (value.expectedTotal !== subtotal + shipping)
    throw new ShopError(
      409,
      'Сумма изменилась. Обновите страницу и проверьте итог перед оплатой.'
    );
  return {
    requestKey: value.requestKey,
    fields,
    lines,
    subtotal,
    shipping,
    total: subtotal + shipping,
    deliveryLabel: delivery.label,
  };
}
export class ShopStore {
  readonly native: Database.Database;
  readonly db;
  constructor(
    path: string,
    private now = () => Date.now()
  ) {
    if (path !== ':memory:')
      mkdirSync(/* turbopackIgnore: true */ dirname(resolve(/* turbopackIgnore: true */ path)), { recursive: true });
    this.native = new Database(path);
    this.native.pragma('journal_mode = WAL');
    this.native.pragma('foreign_keys = ON');
    this.native.pragma('busy_timeout = 5000');
    this.native.exec(`
   CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY);
   CREATE TABLE IF NOT EXISTS inventory(id TEXT PRIMARY KEY,remaining INTEGER NOT NULL CHECK(remaining>=0));
   CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY,number TEXT NOT NULL,owner TEXT NOT NULL,request_key TEXT NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','canceled','expired')),items TEXT NOT NULL,customer TEXT NOT NULL,subtotal INTEGER NOT NULL,shipping INTEGER NOT NULL,total INTEGER NOT NULL,delivery_label TEXT NOT NULL,created_at INTEGER NOT NULL,reserved_until INTEGER NOT NULL,active_attempt TEXT);
   CREATE UNIQUE INDEX IF NOT EXISTS orders_request ON orders(owner,request_key);
   CREATE UNIQUE INDEX IF NOT EXISTS orders_global_request ON orders(request_key);
   CREATE INDEX IF NOT EXISTS orders_reservations ON orders(status,reserved_until);
   CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),request_key TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','succeeded','failed','canceled')),created_at INTEGER NOT NULL,finished_at INTEGER);
   CREATE UNIQUE INDEX IF NOT EXISTS attempts_request ON attempts(order_id,request_key);
   CREATE TABLE IF NOT EXISTS request_limits(owner TEXT PRIMARY KEY,window_start INTEGER NOT NULL,count INTEGER NOT NULL);
   INSERT OR IGNORE INTO schema_versions(version) VALUES(1);
  `);
    migrateMail(this.native);
    migratePayments(this.native);
    this.db = drizzle(this.native);
    for (const product of products)
      this.db
        .insert(inventory)
        .values({ id: product.id, remaining: product.stock })
        .onConflictDoNothing()
        .run();
    migrateCatalog(this.native);
    migrateAdmin(this.native);
  }
  mode(id: string): 'demo' | 'yookassa_test' {
    return this.native
      .prepare('SELECT mode FROM payment_modes WHERE order_id=?')
      .get(id)
      ? 'yookassa_test'
      : 'demo';
  }
  private paymentView(attempt: string | null) {
    if (!attempt) return {};
    const p = this.native
      .prepare(
        'SELECT confirmation_url,error FROM provider_payments WHERE attempt_id=?'
      )
      .get(attempt) as
      { confirmation_url: string | null; error: string | null } | undefined;
    return {
      confirmationUrl: p?.confirmation_url || null,
      paymentError: p?.error || null,
    };
  }
  catalog() {
    return catalog(this.native);
  }
  close() {
    this.native.close();
  }
  private atomic<T>(fn: () => T): T {
    return this.native.transaction(fn).immediate();
  }
  private expire() {
    const stale = this.db
      .select()
      .from(orders)
      .where(
        and(eq(orders.status, 'pending'), lt(orders.reservedUntil, this.now()))
      )
      .all();
    for (const order of stale) {
      if (this.mode(order.id) !== 'demo') continue;
      this.db
        .update(orders)
        .set({ status: 'expired', reservedUntil: 0 })
        .where(eq(orders.id, order.id))
        .run();
      if (order.activeAttempt)
        this.db
          .update(attempts)
          .set({ status: 'canceled', finishedAt: this.now() })
          .where(
            and(
              eq(attempts.id, order.activeAttempt),
              eq(attempts.status, 'pending')
            )
          )
          .run();
    }
  }
  private owned(id: string, owner: string) {
    const order = this.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.owner, owner)))
      .get();
    if (!order)
      throw new ShopError(
        404,
        'Заказ не найден или недоступен в этом браузере.'
      );
    return order;
  }
  private available(lines: OrderLine[], exclude?: string) {
    const reserved = new Map<string, number>();
    for (const order of this.db
      .select()
      .from(orders)
      .where(eq(orders.status, 'pending'))
      .all()) {
      if (order.id === exclude) continue;
      for (const line of order.items)
        reserved.set(line.id, (reserved.get(line.id) || 0) + line.quantity);
    }
    const requested = new Map<string, number>();
    for (const line of lines)
      requested.set(line.id, (requested.get(line.id) || 0) + line.quantity);
    for (const [id, quantity] of requested) {
      const remaining =
        this.db.select().from(inventory).where(eq(inventory.id, id)).get()
          ?.remaining || 0;
      if (quantity > remaining - (reserved.get(id) || 0))
        throw new ShopError(
          409,
          'Недостаточно товара «' +
            lines.find((l) => l.id === id)!.name +
            '». Измените корзину или попробуйте позже.'
        );
    }
  }
  private view(id: string, owner: string): PublicOrder {
    const o = this.owned(id, owner);
    const a = o.activeAttempt
      ? this.db
          .select()
          .from(attempts)
          .where(eq(attempts.id, o.activeAttempt))
          .get()
      : undefined;
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      items: o.items,
      subtotal: o.subtotal,
      shipping: o.shipping,
      total: o.total,
      deliveryLabel: o.deliveryLabel,
      createdAt: o.createdAt,
      reservedUntil: o.reservedUntil,
      activeAttempt: o.activeAttempt,
      attemptStatus: a?.status || null,
      mode: this.mode(o.id),
      ...this.paymentView(o.activeAttempt),
      emailStatus: receiptStatus(this.native, o.id),
    };
  }
  get(id: string, owner: string) {
    return this.atomic(() => {
      this.expire();
      return this.view(id, owner);
    });
  }
  stock(owner?: string) {
    return this.atomic(() => {
      this.expire();
      const reserved = new Map<string, number>();
      for (const order of this.db
        .select()
        .from(orders)
        .where(eq(orders.status, 'pending'))
        .all()) {
        if (owner && order.owner === owner) continue;
        for (const line of order.items)
          reserved.set(line.id, (reserved.get(line.id) || 0) + line.quantity);
      }
      return Object.fromEntries(
        this.db
          .select()
          .from(inventory)
          .all()
          .map((i) => [
            i.id,
            Math.max(0, i.remaining - (reserved.get(i.id) || 0)),
          ])
      );
    });
  }
  create(
    value: unknown,
    owner: string,
    mode: 'demo' | 'yookassa_test' = 'demo'
  ) {
    return this.atomic(() => {
      this.expire();
      const previous =
        record(value) && validKey(value.requestKey)
          ? this.db
              .select()
              .from(orders)
              .where(eq(orders.requestKey, value.requestKey))
              .get()
          : undefined;
      if (previous && previous.owner !== owner)
        throw new ShopError(
          409,
          'Этот запрос уже использован в другом браузере.'
        );
      // Repeated creation uses the original snapshot even if the author changed the catalog.
      const source = previous
        ? previous.items.map((line) => ({
            ...products[0],
            id: line.id,
            name: line.name,
            slug: line.slug,
            image: line.image,
            price: line.unitPrice / 100,
            stock: previous.items
              .filter((i) => i.id === line.id)
              .reduce((sum, i) => sum + i.quantity, 0),
            variants: previous.items
              .filter((i) => i.id === line.id && i.variant)
              .map((i) => i.variant).length
              ? previous.items
                  .filter((i) => i.id === line.id && i.variant)
                  .map((i) => i.variant)
              : undefined,
          }))
        : this.catalog();
      const input = parseOrder(
        previous && record(value)
          ? { ...value, expectedTotal: previous.total }
          : value,
        source
      );
      const fingerprint = hash(
        JSON.stringify({
          fields: input.fields,
          lines: input.lines,
          total: input.total,
        })
      );
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ShopError(
            409,
            'Этот запрос уже использован для другого состава. Проверьте заказ.'
          );
        return this.view(previous.id, owner);
      }
      const limit = this.native
        .prepare('SELECT window_start,count FROM request_limits WHERE owner=?')
        .get(owner) as { window_start: number; count: number } | undefined;
      if (
        limit &&
        this.now() - limit.window_start < 60_000 &&
        limit.count >= 10
      )
        throw new ShopError(429, 'Слишком много заказов. Подождите минуту.');
      this.native
        .prepare(
          'INSERT INTO request_limits VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET window_start=excluded.window_start,count=excluded.count'
        )
        .run(
          owner,
          limit && this.now() - limit.window_start < 60_000
            ? limit.window_start
            : this.now(),
          limit && this.now() - limit.window_start < 60_000
            ? limit.count + 1
            : 1
        );
      this.available(input.lines);
      const id = randomUUID(),
        attempt = randomUUID(),
        createdAt = this.now();
      const number =
        'ПЗ-' +
        new Date(createdAt).toISOString().slice(0, 10).replaceAll('-', '') +
        '-' +
        id.slice(0, 8).toUpperCase();
      this.db
        .insert(orders)
        .values({
          id,
          number,
          owner,
          requestKey: input.requestKey,
          fingerprint,
          status: 'pending',
          items: input.lines,
          customer: input.fields,
          subtotal: input.subtotal,
          shipping: input.shipping,
          total: input.total,
          deliveryLabel: input.deliveryLabel,
          createdAt,
          reservedUntil: createdAt + 30 * 60_000,
          activeAttempt: attempt,
        })
        .run();
      this.db
        .insert(attempts)
        .values({
          id: attempt,
          orderId: id,
          requestKey: input.requestKey,
          status: 'pending',
          createdAt,
        })
        .run();
      if (mode === 'yookassa_test')
        this.native
          .prepare('INSERT INTO payment_modes VALUES(?,?)')
          .run(id, mode);
      return this.view(id, owner);
    });
  }
  retry(id: string, owner: string, requestKey: unknown) {
    if (!validKey(requestKey))
      throw new ShopError(400, 'Некорректный запрос оплаты.');
    return this.atomic(() => {
      this.expire();
      const order = this.owned(id, owner);
      if (order.status === 'paid') return this.view(id, owner);
      const previous = this.db
        .select()
        .from(attempts)
        .where(
          and(eq(attempts.orderId, id), eq(attempts.requestKey, requestKey))
        )
        .get();
      if (previous || order.status === 'pending') return this.view(id, owner);
      this.available(order.items, id);
      const attempt = randomUUID();
      this.db
        .insert(attempts)
        .values({
          id: attempt,
          orderId: id,
          requestKey,
          status: 'pending',
          createdAt: this.now(),
        })
        .run();
      this.db
        .update(orders)
        .set({
          status: 'pending',
          activeAttempt: attempt,
          reservedUntil: this.now() + 30 * 60_000,
        })
        .where(eq(orders.id, id))
        .run();
      return this.view(id, owner);
    });
  }
  resolve(
    id: string,
    owner: string,
    attemptId: unknown,
    result: unknown,
    verifiedProvider = false
  ) {
    if (this.mode(id) !== 'demo' && !verifiedProvider)
      throw new ShopError(
        403,
        'Тестовый платёж подтверждает только API ЮKassa.'
      );
    if (
      typeof attemptId !== 'string' ||
      !['succeeded', 'failed', 'canceled'].includes(String(result))
    )
      throw new ShopError(400, 'Выберите результат демонстрации.');
    return this.atomic(() => {
      this.expire();
      const order = this.owned(id, owner);
      const attempt = this.db
        .select()
        .from(attempts)
        .where(and(eq(attempts.id, attemptId), eq(attempts.orderId, id)))
        .get();
      if (!attempt) throw new ShopError(404, 'Попытка оплаты не найдена.');
      if (attempt.status !== 'pending') {
        if (attempt.status !== result)
          throw new ShopError(
            409,
            'Эта попытка уже завершена. Обновите статус заказа.'
          );
        return this.view(id, owner);
      }
      if (order.activeAttempt !== attempt.id || order.status !== 'pending')
        throw new ShopError(409, 'Попытка оплаты больше не активна.');
      if (result === 'succeeded') {
        for (const line of order.items) {
          const changed = this.native
            .prepare(
              'UPDATE inventory SET remaining=remaining-? WHERE id=? AND remaining>=?'
            )
            .run(line.quantity, line.id, line.quantity);
          this.native
            .prepare(
              'UPDATE inventory_versions SET version=version+1 WHERE id=?'
            )
            .run(line.id);
          if (changed.changes !== 1)
            throw new ShopError(409, 'Товар закончился. Повторите оформление.');
        }
      }
      this.db
        .update(attempts)
        .set({ status: result as AttemptStatus, finishedAt: this.now() })
        .where(eq(attempts.id, attempt.id))
        .run();
      this.db
        .update(orders)
        .set({
          status:
            result === 'succeeded' ? 'paid' : (result as 'failed' | 'canceled'),
          reservedUntil: 0,
        })
        .where(eq(orders.id, id))
        .run();
      if (result === 'succeeded') enqueueReceipt(this.native, order);
      return this.view(id, owner);
    });
  }
}
const globalStore = globalThis as typeof globalThis & { psStore?: ShopStore };
export function getStore() {
  if (
    process.env.PAYMENT_MODE &&
    !['demo', 'yookassa_test'].includes(process.env.PAYMENT_MODE)
  )
    throw new ShopError(
      503,
      'Этот способ оплаты ещё не подключён. Доступен только локальный деморежим.'
    );
  if (
    globalStore.psStore &&
    !((globalStore.psStore as unknown) instanceof ShopStore)
  ) {
    // Route bundles and hot reloads can have distinct class identities.
    // Keep the connection alive for requests already awaiting cookies.
    Object.setPrototypeOf(globalStore.psStore, ShopStore.prototype);
  }
  return (globalStore.psStore ??= new ShopStore(
    process.env.DATABASE_PATH || './data/shop.sqlite'
  ));
}
