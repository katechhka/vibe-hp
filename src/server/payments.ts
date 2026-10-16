import { ShopError } from './store';
import { appStore, type AppStore, rows, execute } from './app-store';
import {
  YooKassa,
  credentials,
  safeConfirmation,
  type Payment,
} from './yookassa';
type Row = {
  attempt_id: string;
  order_id: string;
  request: string;
  first_request: number;
  provider_id: string | null;
  checked_at: number;
};
type OrderRow = {
  id: string;
  owner: string;
  total: number;
  number: string;
  active_attempt: string;
  status: string;
};
export class Payments {
  constructor(
    private store: AppStore = appStore(),
    private api = new YooKassa(),
    private now = () => Date.now()
  ) {}
  private async row(attempt: string) {
    return (
      await rows<Row>(
        this.store,
        'SELECT * FROM provider_payments WHERE attempt_id=?',
        attempt
      )
    )[0];
  }
  private async order(id: string) {
    const o = (
      await rows<OrderRow>(
        this.store,
        'SELECT id,owner,total,number,active_attempt,status FROM orders WHERE id=?',
        id
      )
    )[0];
    return o ? { ...o, total: Number(o.total) } : undefined;
  }

  private async apply(row: Row, payment: Payment) {
    const o = await this.order(row.order_id);
    if (!o) throw new ShopError(404, 'Платёж не найден.');
    const { shopId } = credentials();
    if (
      payment.test !== true ||
      payment.recipient?.account_id !== shopId ||
      payment.amount?.currency !== 'RUB' ||
      payment.amount?.value !== (o.total / 100).toFixed(2) ||
      payment.metadata?.order_id !== o.id ||
      payment.metadata?.attempt_id !== row.attempt_id ||
      (row.provider_id && row.provider_id !== payment.id) ||
      (payment.status === 'succeeded' && payment.paid !== true)
    )
      throw new ShopError(
        502,
        'Данные платежа не совпадают с тестовым заказом. Статус не изменён.'
      );
    const url = safeConfirmation(payment.confirmation?.confirmation_url);
    if (payment.status === 'pending' && !url && !row.provider_id)
      throw new ShopError(
        502,
        'ЮKassa не вернула безопасный адрес тестовой оплаты.'
      );
    await execute(
      this.store,
      'UPDATE provider_payments SET provider_id=?,confirmation_url=COALESCE(?,confirmation_url),checked_at=?,error=NULL WHERE attempt_id=?',
      payment.id,
      url,
      this.now(),
      row.attempt_id
    );
    const current = await this.store.get(o.id, o.owner);
    if (
      current.status === 'paid' ||
      current.activeAttempt !== row.attempt_id ||
      current.attemptStatus !== 'pending'
    )
      return current;
    if (payment.status === 'succeeded')
      return this.store.resolve(
        o.id,
        o.owner,
        row.attempt_id,
        'succeeded',
        true
      );
    if (payment.status === 'canceled') {
      const failed =
        payment.cancellation_details?.party !== 'merchant' &&
        !['canceled_by_user', 'expired_on_confirmation'].includes(
          payment.cancellation_details?.reason || ''
        );
      return this.store.resolve(
        o.id,
        o.owner,
        row.attempt_id,
        failed ? 'failed' : 'canceled',
        true
      );
    }
    // capture:true is used. An unexpected waiting_for_capture never confirms payment.
    return this.store.get(o.id, o.owner);
  }
  async start(id: string, owner: string) {
    const order = await this.store.get(id, owner);
    if (order.mode === 'demo' || order.status !== 'pending') return order;
    credentials(); // Reject live keys before any network request.
    const attempt = order.activeAttempt!;
    let row = await this.row(attempt);
    if (!row) {
      const origin = new URL(process.env.APP_URL || 'http://127.0.0.1:3000');
      if (
        origin.pathname !== '/' ||
        !['http:', 'https:'].includes(origin.protocol) ||
        origin.username ||
        origin.password ||
        (origin.protocol !== 'https:' &&
          !['127.0.0.1', 'localhost'].includes(origin.hostname))
      )
        throw new ShopError(
          503,
          'APP_URL должен быть публичным HTTPS-адресом или локальным адресом разработки.'
        );
      const request = JSON.stringify({
        amount: { value: (order.total / 100).toFixed(2), currency: 'RUB' },
        capture: true,
        payment_method_data: { type: 'bank_card' },
        confirmation: {
          type: 'redirect',
          return_url: new URL('/orders/' + id, origin).href,
        },
        description: 'Тестовый заказ ' + order.number,
        metadata: { order_id: id, attempt_id: attempt },
      });
      await execute(
        this.store,
        'INSERT OR IGNORE INTO provider_payments(attempt_id,order_id,request,first_request) VALUES(?,?,?,?)',
        attempt,
        id,
        request,
        this.now()
      );
      row = (await this.row(attempt))!;
    }
    try {
      if (row.provider_id)
        return await this.apply(row, await this.api.get(row.provider_id));
      // Provider idempotence lasts 24 hours. Never recreate an unknown old payment.
      if (this.now() - row.first_request >= 23 * 60 * 60_000)
        throw new ShopError(
          409,
          'Нужна проверка платежа разработчиком: ответ ЮKassa не был сохранён. Новый платёж автоматически не создаётся.'
        );
      return await this.apply(
        row,
        await this.api.create(JSON.parse(row.request), attempt)
      );
    } catch (error) {
      await execute(
        this.store,
        'UPDATE provider_payments SET error=? WHERE attempt_id=?',
        error instanceof ShopError
          ? error.message
          : 'Не удалось проверить тестовую оплату. Повторите попытку.',
        attempt
      );
      // The order exists even if the provider is unavailable. No anonymous second order.
      return this.store.get(id, owner);
    }
  }
  async refresh(id: string, owner: string) {
    const order = await this.store.get(id, owner);
    if (order.mode === 'demo' || order.status !== 'pending') return order;
    const row = await this.row(order.activeAttempt!);
    if (!row?.provider_id || this.now() - row.checked_at < 4000) return order;
    try {
      return await this.apply(row, await this.api.get(row.provider_id));
    } catch {
      await execute(
        this.store,
        'UPDATE provider_payments SET checked_at=?,error=? WHERE attempt_id=?',
        this.now(),
        'Статус ЮKassa пока не удалось проверить. Повторите проверку; заказ сохранён.',
        row.attempt_id
      );
      return this.store.get(id, owner);
    }
  }
  async webhook(value: unknown) {
    const v = value as {
      type?: string;
      event?: string;
      object?: { id?: string; metadata?: { attempt_id?: string } };
    };
    if (
      !v ||
      v.type !== 'notification' ||
      ![
        'payment.succeeded',
        'payment.canceled',
        'payment.waiting_for_capture',
      ].includes(v.event || '') ||
      typeof v.object?.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(v.object.id)
    )
      throw new ShopError(400, 'Некорректное уведомление.');
    let row = (
      await rows<Row>(
        this.store,
        'SELECT * FROM provider_payments WHERE provider_id=?',
        v.object.id
      )
    )[0];
    // A notification may arrive before the create response. Only a persisted attempt is eligible.
    if (!row && typeof v.object.metadata?.attempt_id === 'string')
      row = await this.row(v.object.metadata.attempt_id);
    if (!row) return null; // Unknown payments reveal nothing and never change orders.
    const payment = await this.api.get(v.object.id); // Ignore all payload amounts/statuses.
    return await this.apply(row, payment);
  }
}
