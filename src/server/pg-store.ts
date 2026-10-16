import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pgTransaction } from './postgres';
import { ShopError, parseOrder, hash, validKey } from './store';
import { products as seed, type Product } from '../data/catalog';
import type {
  PublicOrder,
  OrderLine,
  OrderStatus,
  AttemptStatus,
} from '../lib/order-types';
import type { CheckoutFields } from '../lib/checkout';
import { validateProduct } from './catalog-store';
import { passwordHash, verifyPassword } from './admin-auth';
import { receiptContent } from './receipt';
import { mailConfigured, type MailRow } from './mail-queue';
type Row = Record<string, any>;
export type AdminProduct = Product & {
  reserved: number;
  available: number;
  stockRevision: number;
};
const tokenHash = (v: string) => createHash('sha256').update(v).digest('hex');
export const pgSchema = () => {
  const s = process.env.PG_SCHEMA || 'shop';
  if (!/^[a-z][a-z0-9_]{0,60}$/.test(s)) throw Error('INVALID_PG_SCHEMA');
  return s;
};
// One small shop: serialize mutations across serverless instances, as SQLite did.
// Network requests to payment/email providers happen outside this lock.
export async function shopTransaction<T>(fn: (c: PoolClient) => Promise<T>) {
  return pgTransaction(async (c) => {
    await c.query('SET LOCAL search_path TO "' + pgSchema() + '", pg_catalog');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [pgSchema()]);
    return fn(c);
  });
}
export class PgShopStore {
  constructor(
    private now = () => Date.now(),
    private transaction: typeof shopTransaction = shopTransaction
  ) {}
  async query(sql: string, params: unknown[] = []) {
    return this.transaction(
      async (c) => (await c.query(sql, params)).rows as Row[]
    );
  }
  async execute(sql: string, params: unknown[] = []) {
    return this.transaction(async (c) => ({
      changes: (await c.query(sql, params)).rowCount || 0,
    }));
  }
  private async expire(c: PoolClient) {
    const rows = (
      await c.query(
        "UPDATE orders o SET status='expired',reserved_until=0 WHERE status='pending' AND reserved_until<$1 AND NOT EXISTS(SELECT 1 FROM payment_modes m WHERE m.order_id=o.id) RETURNING active_attempt",
        [this.now()]
      )
    ).rows;
    for (const r of rows)
      if (r.active_attempt)
        await c.query(
          "UPDATE attempts SET status='canceled',finished_at=$1 WHERE id=$2 AND status='pending'",
          [this.now(), r.active_attempt]
        );
  }
  private async owned(c: PoolClient, id: string, owner: string) {
    const o = (
      await c.query('SELECT * FROM orders WHERE id=$1 AND owner=$2', [
        id,
        owner,
      ])
    ).rows[0];
    if (!o)
      throw new ShopError(
        404,
        'Заказ не найден или недоступен в этом браузере.'
      );
    return o as Row;
  }
  private async catalogRows(c: PoolClient, admin = false): Promise<Product[]> {
    return (
      await c.query(
        'SELECT c.data,c.visible,c.revision,i.remaining FROM catalog c JOIN inventory i ON i.id=c.id ' +
          (admin ? '' : 'WHERE c.visible=1') +
          ' ORDER BY c.position'
      )
    ).rows.map((r) => ({
      ...JSON.parse(r.data),
      stock: r.remaining,
      visible: !!r.visible,
      revision: r.revision,
    }));
  }
  async catalog() {
    return this.transaction((c) => this.catalogRows(c));
  }
  private async stockRows(c: PoolClient, owner?: string) {
    const reserved = new Map<string, number>();
    const orders = (
      await c.query("SELECT items,owner FROM orders WHERE status='pending'")
    ).rows;
    for (const o of orders) {
      if (owner && o.owner === owner) continue;
      for (const l of JSON.parse(o.items) as OrderLine[])
        reserved.set(l.id, (reserved.get(l.id) || 0) + l.quantity);
    }
    return Object.fromEntries(
      (await c.query('SELECT * FROM inventory')).rows.map((i) => [
        i.id,
        Math.max(0, i.remaining - (reserved.get(i.id) || 0)),
      ])
    ) as Record<string, number>;
  }
  async stock(owner?: string) {
    return this.transaction(async (c) => {
      await this.expire(c);
      return this.stockRows(c, owner);
    });
  }
  private async available(c: PoolClient, lines: OrderLine[], exclude?: string) {
    const reserved = new Map<string, number>();
    for (const o of (
      await c.query("SELECT id,items FROM orders WHERE status='pending'")
    ).rows) {
      if (o.id === exclude) continue;
      for (const l of JSON.parse(o.items) as OrderLine[])
        reserved.set(l.id, (reserved.get(l.id) || 0) + l.quantity);
    }
    const requested = new Map<string, number>();
    for (const l of lines)
      requested.set(l.id, (requested.get(l.id) || 0) + l.quantity);
    for (const [id, qty] of requested) {
      const r = (
        await c.query('SELECT remaining FROM inventory WHERE id=$1', [id])
      ).rows[0];
      if (qty > (r?.remaining || 0) - (reserved.get(id) || 0))
        throw new ShopError(
          409,
          'Недостаточно товара. Обновите корзину или попробуйте позже.'
        );
    }
  }
  private async view(
    c: PoolClient,
    id: string,
    owner: string
  ): Promise<PublicOrder> {
    const o = await this.owned(c, id, owner);
    const a = o.active_attempt
      ? (
          await c.query('SELECT * FROM attempts WHERE id=$1', [
            o.active_attempt,
          ])
        ).rows[0]
      : undefined;
    const mode = (
      await c.query('SELECT mode FROM payment_modes WHERE order_id=$1', [id])
    ).rowCount
      ? 'yookassa_test'
      : 'demo';
    const p = o.active_attempt
      ? (
          await c.query(
            'SELECT confirmation_url,error FROM provider_payments WHERE attempt_id=$1',
            [o.active_attempt]
          )
        ).rows[0]
      : undefined;
    const mail = (
      await c.query('SELECT status FROM mail_outbox WHERE order_id=$1', [id])
    ).rows[0];
    const emailStatus = !mail
      ? 'not_requested'
      : mail.status === 'sent'
        ? 'sent'
        : !mailConfigured()
          ? 'not_configured'
          : mail.status === 'sending'
            ? 'pending'
            : mail.status;
    return {
      id: o.id,
      number: o.number,
      status: o.status as OrderStatus,
      items: JSON.parse(o.items),
      subtotal: Number(o.subtotal),
      shipping: Number(o.shipping),
      total: Number(o.total),
      deliveryLabel: o.delivery_label,
      createdAt: Number(o.created_at),
      reservedUntil: Number(o.reserved_until),
      activeAttempt: o.active_attempt,
      attemptStatus: (a?.status as AttemptStatus) || null,
      mode,
      confirmationUrl: p?.confirmation_url || null,
      paymentError: p?.error || null,
      emailStatus,
    };
  }
  async get(id: string, owner: string) {
    return this.transaction(async (c) => {
      await this.expire(c);
      return this.view(c, id, owner);
    });
  }
  async create(
    value: unknown,
    owner: string,
    mode: 'demo' | 'yookassa_test' = 'demo'
  ) {
    if (!['demo', 'yookassa_test'].includes(mode))
      throw new ShopError(503, 'Доступна только тестовая оплата.');
    return this.transaction(async (c) => {
      await this.expire(c);
      const v = value as Row;
      const previous =
        v && validKey(v.requestKey)
          ? (
              await c.query('SELECT * FROM orders WHERE request_key=$1', [
                v.requestKey,
              ])
            ).rows[0]
          : undefined;
      if (previous && previous.owner !== owner)
        throw new ShopError(
          409,
          'Этот запрос уже использован в другом браузере.'
        );
      const oldLines = previous
        ? (JSON.parse(previous.items) as OrderLine[])
        : [];
      const source = previous
        ? oldLines.map((l) => ({
            ...seed[0],
            id: l.id,
            name: l.name,
            slug: l.slug,
            image: l.image,
            price: l.unitPrice / 100,
            stock: oldLines
              .filter((i) => i.id === l.id)
              .reduce((s, i) => s + i.quantity, 0),
            variants: oldLines
              .filter((i) => i.id === l.id && i.variant)
              .map((i) => i.variant).length
              ? oldLines
                  .filter((i) => i.id === l.id && i.variant)
                  .map((i) => i.variant)
              : undefined,
          }))
        : await this.catalogRows(c);
      const input = parseOrder(
        previous ? { ...v, expectedTotal: Number(previous.total) } : value,
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
        return this.view(c, previous.id, owner);
      }
      const limit = (
        await c.query('SELECT * FROM request_limits WHERE owner=$1', [owner])
      ).rows[0];
      const recent = limit && this.now() - Number(limit.window_start) < 60000;
      if (recent && limit.count >= 10)
        throw new ShopError(429, 'Слишком много запросов. Подождите минуту.');
      await c.query(
        'INSERT INTO request_limits VALUES($1,$2,$3) ON CONFLICT(owner) DO UPDATE SET window_start=excluded.window_start,count=excluded.count',
        [
          owner,
          recent ? limit.window_start : this.now(),
          recent ? limit.count + 1 : 1,
        ]
      );
      await this.available(c, input.lines);
      const id = randomUUID(),
        attempt = randomUUID(),
        now = this.now(),
        number =
          'ПЗ-' +
          new Date(now).toISOString().slice(0, 10).replaceAll('-', '') +
          '-' +
          id.slice(0, 8).toUpperCase();
      await c.query(
        "INSERT INTO orders(id,number,owner,request_key,fingerprint,status,items,customer,subtotal,shipping,total,delivery_label,created_at,reserved_until,active_attempt) VALUES($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13,$14)",
        [
          id,
          number,
          owner,
          input.requestKey,
          fingerprint,
          JSON.stringify(input.lines),
          JSON.stringify(input.fields),
          input.subtotal,
          input.shipping,
          input.total,
          input.deliveryLabel,
          now,
          now + 30 * 60000,
          attempt,
        ]
      );
      await c.query(
        "INSERT INTO attempts(id,order_id,request_key,status,created_at) VALUES($1,$2,$3,'pending',$4)",
        [attempt, id, input.requestKey, now]
      );
      if (mode === 'yookassa_test')
        await c.query('INSERT INTO payment_modes VALUES($1,$2)', [id, mode]);
      return this.view(c, id, owner);
    });
  }
  async retry(id: string, owner: string, key: unknown) {
    if (!validKey(key)) throw new ShopError(400, 'Некорректный ключ запроса.');
    return this.transaction(async (c) => {
      await this.expire(c);
      const o = await this.owned(c, id, owner);
      if (
        o.status === 'paid' ||
        o.status === 'pending' ||
        (
          await c.query(
            'SELECT 1 FROM attempts WHERE order_id=$1 AND request_key=$2',
            [id, key]
          )
        ).rowCount
      )
        return this.view(c, id, owner);
      await this.available(c, JSON.parse(o.items), id);
      const a = randomUUID();
      await c.query(
        "INSERT INTO attempts(id,order_id,request_key,status,created_at) VALUES($1,$2,$3,'pending',$4)",
        [a, id, key, this.now()]
      );
      await c.query(
        "UPDATE orders SET status='pending',active_attempt=$1,reserved_until=$2 WHERE id=$3",
        [a, this.now() + 30 * 60000, id]
      );
      return this.view(c, id, owner);
    });
  }
  async resolve(
    id: string,
    owner: string,
    attemptId: unknown,
    result: unknown,
    verified = false
  ) {
    if (
      typeof attemptId !== 'string' ||
      !['succeeded', 'failed', 'canceled'].includes(String(result))
    )
      throw new ShopError(400, 'Выберите результат демонстрации.');
    return this.transaction(async (c) => {
      await this.expire(c);
      const o = await this.owned(c, id, owner);
      if (
        !verified &&
        (await c.query('SELECT 1 FROM payment_modes WHERE order_id=$1', [id]))
          .rowCount
      )
        throw new ShopError(403, 'Этот платёж подтверждает только API ЮKassa.');
      const a = (
        await c.query('SELECT * FROM attempts WHERE id=$1 AND order_id=$2', [
          attemptId,
          id,
        ])
      ).rows[0];
      if (!a) throw new ShopError(404, 'Попытка оплаты не найдена.');
      if (a.status !== 'pending') {
        if (a.status !== result)
          throw new ShopError(
            409,
            'Эта попытка уже завершена. Обновите статус заказа.'
          );
        return this.view(c, id, owner);
      }
      if (o.active_attempt !== a.id || o.status !== 'pending')
        throw new ShopError(409, 'Попытка оплаты больше не активна.');
      const lines = JSON.parse(o.items) as OrderLine[];
      if (result === 'succeeded')
        for (const l of lines) {
          if (
            (
              await c.query(
                'UPDATE inventory SET remaining=remaining-$1 WHERE id=$2 AND remaining>=$1',
                [l.quantity, l.id]
              )
            ).rowCount !== 1
          )
            throw new ShopError(409, 'Товар закончился. Повторите оформление.');
          await c.query(
            'UPDATE inventory_versions SET version=version+1 WHERE id=$1',
            [l.id]
          );
        }
      await c.query(
        'UPDATE attempts SET status=$1,finished_at=$2 WHERE id=$3',
        [result, this.now(), a.id]
      );
      await c.query(
        'UPDATE orders SET status=$1,reserved_until=0 WHERE id=$2',
        [result === 'succeeded' ? 'paid' : result, id]
      );
      if (result === 'succeeded') {
        const payload = receiptContent({
          id: o.id,
          number: o.number,
          items: lines,
          customer: JSON.parse(o.customer),
          subtotal: Number(o.subtotal),
          shipping: Number(o.shipping),
          total: Number(o.total),
          deliveryLabel: o.delivery_label,
        });
        await c.query(
          "INSERT INTO mail_outbox(order_id,status,payload) VALUES($1,'pending',$2) ON CONFLICT DO NOTHING",
          [id, JSON.stringify(payload)]
        );
      }
      return this.view(c, id, owner);
    });
  }
  private async adminRows(c: PoolClient): Promise<AdminProduct[]> {
    const available = await this.stockRows(c);
    const versions = Object.fromEntries(
      (await c.query('SELECT * FROM inventory_versions')).rows.map((r) => [
        r.id,
        r.version,
      ])
    );
    return (await this.catalogRows(c, true)).map((p) => ({
      ...p,
      reserved: p.stock - (available[p.id] || 0),
      available: available[p.id] || 0,
      stockRevision: versions[p.id],
    }));
  }
  async adminProducts() {
    return this.transaction(async (c) => {
      await this.expire(c);
      return this.adminRows(c);
    });
  }
  async saveProduct(input: unknown) {
    return this.transaction(async (c) => {
      await this.expire(c);
      const { v, clean, existing } = validateProduct(
        input,
        await this.catalogRows(c, true)
      );
      const live = (await this.adminRows(c)).find((p) => p.id === clean.id);
      if (
        live &&
        (v.stockRevision !== live.stockRevision || v.revision !== live.revision)
      )
        throw new ShopError(
          409,
          'Товар или остаток уже изменён. Обновите список и откройте товар заново.'
        );
      if (live && clean.stock < live.reserved)
        throw new ShopError(
          409,
          'Остаток не может быть меньше резерва: ' + live.reserved + ' шт.'
        );
      if (
        live?.reserved &&
        JSON.stringify(existing?.variants || []) !==
          JSON.stringify(clean.variants || [])
      )
        throw new ShopError(
          409,
          'Варианты нельзя менять, пока товар есть в ожидающем заказе.'
        );
      if (
        (
          await c.query('SELECT 1 FROM catalog WHERE slug=$1 AND id<>$2', [
            clean.slug,
            clean.id,
          ])
        ).rowCount
      )
        throw new ShopError(409, 'Этот адрес товара уже занят.');
      await c.query(
        'INSERT INTO inventory VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET remaining=excluded.remaining',
        [clean.id, clean.stock]
      );
      await c.query(
        'INSERT INTO inventory_versions VALUES($1,1) ON CONFLICT(id) DO UPDATE SET version=inventory_versions.version+1',
        [clean.id]
      );
      await c.query(
        'INSERT INTO catalog(id,slug,data,visible,revision) VALUES($1,$2,$3,$4,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,visible=excluded.visible,revision=catalog.revision+1',
        [clean.id, clean.slug, JSON.stringify(clean), v.visible ? 1 : 0]
      );
      return (await this.adminRows(c)).find((p) => p.id === clean.id)!;
    });
  }
  async adminOrders(id?: string | null) {
    return this.transaction(async (c) => {
      if (!id)
        return (
          await c.query(
            'SELECT id,number,status,total,created_at FROM orders ORDER BY created_at DESC LIMIT 100'
          )
        ).rows.map((r) => ({
          ...r,
          total: Number(r.total),
          created_at: Number(r.created_at),
        }));
      const r = (
        await c.query(
          'SELECT id,number,status,items,customer,subtotal,shipping,total,delivery_label,created_at FROM orders WHERE id=$1',
          [id]
        )
      ).rows[0];
      if (!r) throw new ShopError(404, 'Заказ не найден.');
      return {
        ...r,
        items: JSON.parse(r.items),
        customer: JSON.parse(r.customer),
        subtotal: Number(r.subtotal),
        shipping: Number(r.shipping),
        total: Number(r.total),
        created_at: Number(r.created_at),
      };
    });
  }
  async login(password: unknown) {
    return this.transaction(async (c) => {
      const now = this.now(),
        limit = (await c.query('SELECT * FROM admin_login_limit WHERE id=1'))
          .rows[0],
        recent = limit && now - Number(limit.window_start) < 15 * 60000;
      if (recent && limit.count >= 10)
        throw new ShopError(
          429,
          'Слишком много попыток. Попробуйте через 15 минут.'
        );
      const account = (
        await c.query('SELECT password_hash FROM admin_account WHERE id=1')
      ).rows[0];
      if (!account) throw new ShopError(503, 'Админка не настроена.');
      await c.query(
        'INSERT INTO admin_login_limit VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET window_start=excluded.window_start,count=excluded.count',
        [recent ? limit.window_start : now, recent ? limit.count + 1 : 1]
      );
      if (!verifyPassword(password, account.password_hash)) return null;
      await c.query('DELETE FROM admin_login_limit');
      await c.query('DELETE FROM admin_sessions WHERE expires<$1', [now]);
      const token = randomBytes(32).toString('hex');
      await c.query('INSERT INTO admin_sessions VALUES($1,$2)', [
        tokenHash(token),
        now + 8 * 60 * 60000,
      ]);
      return token;
    });
  }
  async authenticated(token: unknown) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      return false;
    return !!(
      await this.query(
        'SELECT 1 FROM admin_sessions WHERE token_hash=$1 AND expires>$2',
        [tokenHash(token), this.now()]
      )
    ).length;
  }
  async logout(token: string) {
    await this.execute('DELETE FROM admin_sessions WHERE token_hash=$1', [
      tokenHash(token),
    ]);
  }
  async changePassword(current: unknown, next: unknown) {
    if (typeof next !== 'string')
      throw new ShopError(400, 'Введите новый пароль.');
    const encoded = passwordHash(next);
    await this.transaction(async (c) => {
      const r = (
        await c.query('SELECT password_hash FROM admin_account WHERE id=1')
      ).rows[0];
      if (!r || !verifyPassword(current, r.password_hash))
        throw new ShopError(400, 'Текущий пароль неверен.');
      await c.query('UPDATE admin_account SET password_hash=$1 WHERE id=1', [
        encoded,
      ]);
      await c.query('DELETE FROM admin_sessions');
    });
  }
  async claimMail(id: string, sender: string): Promise<MailRow | null> {
    return this.transaction(async (c) => {
      const r = (
        await c.query('SELECT * FROM mail_outbox WHERE order_id=$1', [id])
      ).rows[0];
      const now = this.now();
      if (
        !r ||
        ['sent', 'review'].includes(r.status) ||
        Number(r.lease_until) > now ||
        Number(r.next_attempt) > now
      )
        return null;
      if (
        (r.first_attempt !== null &&
          now - Number(r.first_attempt) >= 23 * 60 * 60000) ||
        r.attempts >= 5
      ) {
        await c.query(
          "UPDATE mail_outbox SET status='review',lease_until=0,last_error='review_required' WHERE order_id=$1",
          [id]
        );
        return null;
      }
      const row = (
        await c.query(
          "UPDATE mail_outbox SET status='sending',sender=COALESCE(sender,$1),first_attempt=COALESCE(first_attempt,$2),attempts=attempts+1,lease_until=$3,last_error=NULL WHERE order_id=$4 RETURNING *",
          [sender, now, now + 120000, id]
        )
      ).rows[0];
      return {
        ...row,
        first_attempt: Number(row.first_attempt),
        lease_until: Number(row.lease_until),
        next_attempt: Number(row.next_attempt),
      } as MailRow;
    });
  }
  async finishMail(row: MailRow, id: string | null, error: string | null) {
    const delay = Math.min(
      15 * 60000,
      60000 * 2 ** Math.max(0, row.attempts - 1)
    );
    await this.execute(
      "UPDATE mail_outbox SET status=$1,provider_id=$2,last_error=$3,lease_until=0,next_attempt=$4 WHERE order_id=$5 AND status='sending' AND attempts=$6",
      [
        id ? 'sent' : 'failed',
        id,
        error,
        id ? 0 : this.now() + delay,
        row.order_id,
        row.attempts,
      ]
    );
  }
}
