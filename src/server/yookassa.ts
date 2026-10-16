import { ShopError } from './store';
export type Payment = {
  id: string;
  status: 'pending' | 'waiting_for_capture' | 'succeeded' | 'canceled';
  test: boolean;
  paid: boolean;
  amount: { value: string; currency: string };
  recipient: { account_id: string };
  metadata: { order_id: string; attempt_id: string };
  confirmation?: { type: string; confirmation_url?: string };
  cancellation_details?: { party?: string; reason?: string };
};
export function paymentMode(): 'demo' | 'yookassa_test' {
  const mode = process.env.PAYMENT_MODE || 'demo';
  if (mode !== 'demo' && mode !== 'yookassa_test')
    throw new ShopError(
      503,
      'Разрешены только локальная демонстрация и тестовая ЮKassa.'
    );
  return mode;
}
export function credentials() {
  const shopId = process.env.YOOKASSA_SHOP_ID || '',
    secret = process.env.YOOKASSA_SECRET_KEY || '';
  if (!/^\d+$/.test(shopId) || !/^test_[\w-]+$/.test(secret))
    throw new ShopError(
      503,
      'Нужны идентификатор и секретный ключ тестового магазина ЮKassa. Рабочие ключи запрещены.'
    );
  return { shopId, secret };
}
export function safeConfirmation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      ['yoomoney.ru', 'yookassa.ru'].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export class YooKassa {
  constructor(private fetcher: typeof fetch = fetch) {}
  async request(path: string, body?: unknown, key?: string): Promise<Payment> {
    const { shopId, secret } = credentials();
    let response: Response;
    try {
      response = await this.fetcher('https://api.yookassa.ru/v3/' + path, {
        method: body ? 'POST' : 'GET',
        redirect: 'error',
        cache: 'no-store',
        headers: {
          Authorization:
            'Basic ' + Buffer.from(shopId + ':' + secret).toString('base64'),
          'Content-Type': 'application/json',
          ...(key ? { 'Idempotence-Key': key } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw new ShopError(
        503,
        'ЮKassa временно недоступна. Заказ сохранён; повторите проверку или переход к оплате.'
      );
    }
    if (!response.ok)
      throw new ShopError(
        503,
        'ЮKassa не подтвердила запрос. Заказ сохранён. Проверьте настройки тестового магазина и повторите попытку.'
      );
    const data = (await response.json()) as Payment;
    if (
      !data ||
      typeof data.id !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(data.id) ||
      !['pending', 'waiting_for_capture', 'succeeded', 'canceled'].includes(
        data.status
      )
    )
      throw new ShopError(
        503,
        'Получен некорректный ответ платёжного сервиса.'
      );
    return data;
  }
  create(body: unknown, key: string) {
    return this.request('payments', body, key);
  }
  get(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id))
      throw new ShopError(400, 'Некорректный идентификатор платежа.');
    return this.request('payments/' + id);
  }
}
