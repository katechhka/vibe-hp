import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ShopStore, ShopError } from './store';
import { Payments } from './payments';
import { YooKassa, safeConfirmation, credentials } from './yookassa';
import { initialCheckout } from '../lib/checkout';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
process.env.YOOKASSA_SHOP_ID = '123456';
process.env.YOOKASSA_SECRET_KEY = 'test_unit_test_only';
process.env.EMAIL_MODE = 'disabled';
const request = () => ({
  requestKey: randomUUID(),
  fields: {
    ...initialCheckout,
    name: 'Тест',
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
function fixture(path = ':memory:') {
  let now = Date.now(),
    state = 'pending',
    calls = 0,
    getCalls = 0;
  const s = new ShopStore(path, () => now);
  const o = s.create(request(), 'owner', 'yookassa_test');
  const paymentId = randomUUID();
  let body: any,
    broken = false,
    mutation: (p: any) => void = () => {};
  const fetcher = (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.ok(String(_url).startsWith('https://api.yookassa.ru/v3/payments'));
    if (init?.method === 'POST') {
      calls++;
      assert.equal(
        init.headers &&
          (init.headers as Record<string, string>)['Idempotence-Key'],
        o.activeAttempt
      );
      const next = JSON.parse(init.body as string);
      if (body) assert.deepEqual(next, body);
      body = next;
      assert.equal(body.capture, true);
      assert.equal(body.amount.value, '640.00');
      assert.deepEqual(body.payment_method_data, { type: 'bank_card' });
      assert.ok(!JSON.stringify(body).includes('test@example.com'));
    } else getCalls++;
    if (broken) throw new Error('network');
    const p = {
      id: paymentId,
      status: state,
      test: true,
      paid: state === 'succeeded',
      amount: body.amount,
      recipient: { account_id: '123456' },
      metadata: body.metadata,
      confirmation: {
        type: 'redirect',
        confirmation_url:
          'https://yoomoney.ru/checkout/payments/v2/contract?orderId=' +
          paymentId,
      },
    };
    mutation(p);
    return Response.json(p);
  }) as typeof fetch;
  const service = new Payments(s, new YooKassa(fetcher), () => now);
  return {
    s,
    o,
    service,
    setState: (v: string) => (state = v),
    advance: (ms: number) => (now += ms),
    break: (v: boolean) => (broken = v),
    mutate: (fn: (p: any) => void) => (mutation = fn),
    calls: () => calls,
    gets: () => getCalls,
    paymentId,
  };
}
test('Provider creation uses frozen authoritative amount, metadata and durable idempotence', async () => {
  const f = fixture();
  try {
    const [a, b] = await Promise.all([
      f.service.start(f.o.id, 'owner'),
      f.service.start(f.o.id, 'owner'),
    ]);
    assert.equal(a.mode, 'yookassa_test');
    assert.equal(a.confirmationUrl, b.confirmationUrl);
    assert.equal(
      (
        f.s.native.prepare('SELECT COUNT(*) n FROM orders').get() as {
          n: number;
        }
      ).n,
      1
    );
    assert.equal(
      (
        f.s.native
          .prepare('SELECT COUNT(*) n FROM provider_payments')
          .get() as { n: number }
      ).n,
      1
    );
    await f.service.start(f.o.id, 'owner');
    assert.equal(f.calls(), 2);
    assert.ok(f.gets() > 0);
    assert.throws(
      () => f.s.resolve(f.o.id, 'owner', f.o.activeAttempt, 'succeeded'),
      ShopError
    );
  } finally {
    f.s.close();
  }
});
test('Provider failure retains same order and retries same attempt after lost response', async () => {
  const f = fixture();
  try {
    f.break(true);
    const first = await f.service.start(f.o.id, 'owner');
    assert.equal(first.status, 'pending');
    assert.ok(first.paymentError);
    f.break(false);
    const next = await f.service.start(f.o.id, 'owner');
    assert.equal(next.id, first.id);
    assert.equal(next.activeAttempt, first.activeAttempt);
    assert.ok(next.confirmationUrl);
    assert.equal(f.calls(), 2);
  } finally {
    f.s.close();
  }
});
test('Unconfirmed provider reserves never expire locally; payment succeeds exactly once with email queue', async () => {
  const f = fixture();
  try {
    await f.service.start(f.o.id, 'owner');
    f.advance(31 * 60_000);
    assert.equal(f.s.get(f.o.id, 'owner').status, 'pending');
    assert.equal(f.s.stock()['ps-001'], 11);
    f.setState('succeeded');
    const paid = await f.service.refresh(f.o.id, 'owner');
    assert.equal(paid.status, 'paid');
    await Promise.all(
      Array.from({ length: 5 }, () =>
        f.service.webhook({
          type: 'notification',
          event: 'payment.succeeded',
          object: { id: f.paymentId },
        })
      )
    );
    assert.equal(f.s.stock()['ps-001'], 11);
    assert.equal(
      (
        f.s.native.prepare('SELECT COUNT(*) n FROM mail_outbox').get() as {
          n: number;
        }
      ).n,
      1
    );
  } finally {
    f.s.close();
  }
});
test('Forged success webhook uses API pending status, not notification status or amounts', async () => {
  const f = fixture();
  try {
    await f.service.start(f.o.id, 'owner');
    const o = await f.service.webhook({
      type: 'notification',
      event: 'payment.succeeded',
      object: {
        id: f.paymentId,
        status: 'succeeded',
        paid: true,
        amount: { value: '0.01' },
      },
    });
    assert.equal(o?.status, 'pending');
    assert.equal(
      (
        f.s.native.prepare('SELECT COUNT(*) n FROM mail_outbox').get() as {
          n: number;
        }
      ).n,
      0
    );
    assert.equal(
      await f.service.webhook({
        type: 'notification',
        event: 'payment.succeeded',
        object: { id: randomUUID() },
      }),
      null
    );
    await assert.rejects(
      () => f.service.refresh(f.o.id, 'stranger'),
      ShopError
    );
  } finally {
    f.s.close();
  }
});
test('Webhook before create response can reconcile only a persisted attempt through verified API', async () => {
  const f = fixture();
  try {
    f.break(true);
    await f.service.start(f.o.id, 'owner');
    f.break(false);
    f.setState('succeeded');
    const paid = await f.service.webhook({
      type: 'notification',
      event: 'payment.succeeded',
      object: { id: f.paymentId, metadata: { attempt_id: f.o.activeAttempt } },
    });
    assert.equal(paid?.status, 'paid');
  } finally {
    f.s.close();
  }
});
test('Reject live, wrong currency, amount, merchant, metadata and unsafe redirect', async () => {
  for (const mutate of [
    (p: any) => (p.test = false),
    (p: any) => (p.amount = { value: '0.01', currency: 'RUB' }),
    (p: any) => (p.amount.currency = 'USD'),
    (p: any) => (p.recipient.account_id = '999'),
    (p: any) => (p.metadata.order_id = 'other'),
    (p: any) => (p.confirmation.confirmation_url = 'https://evil.example/pay'),
    (p: any) => {
      p.status = 'succeeded';
      p.paid = false;
    },
  ]) {
    const f = fixture();
    try {
      f.mutate(mutate);
      const o = await f.service.start(f.o.id, 'owner');
      assert.equal(o.status, 'pending');
      assert.ok(o.paymentError);
      assert.equal(
        (
          f.s.native.prepare('SELECT COUNT(*) n FROM mail_outbox').get() as {
            n: number;
          }
        ).n,
        0
      );
    } finally {
      f.s.close();
    }
  }
  const old = process.env.YOOKASSA_SECRET_KEY;
  process.env.YOOKASSA_SECRET_KEY = 'live_forbidden';
  try {
    assert.throws(credentials, ShopError);
  } finally {
    process.env.YOOKASSA_SECRET_KEY = old;
  }
  assert.equal(safeConfirmation('https://yoomoney.ru.evil.example/pay'), null);
  assert.equal(safeConfirmation('http://yoomoney.ru/pay'), null);
  assert.equal(safeConfirmation('https://user:password@yoomoney.ru/pay'), null);
});
test('Confirmed cancellation releases reserve, retry reuses order and terminal state is monotonic', async () => {
  const f = fixture();
  try {
    await f.service.start(f.o.id, 'owner');
    f.setState('canceled');
    const canceled = await f.service.webhook({
      type: 'notification',
      event: 'payment.canceled',
      object: { id: f.paymentId },
    });
    assert.equal(canceled?.status, 'failed');
    assert.equal(f.s.stock()['ps-001'], 12);
    f.setState('pending');
    const same = await f.service.webhook({
      type: 'notification',
      event: 'payment.succeeded',
      object: { id: f.paymentId },
    });
    assert.equal(same?.status, 'failed');
    const retry = f.s.retry(f.o.id, 'owner', randomUUID());
    assert.equal(retry.id, f.o.id);
    assert.notEqual(retry.activeAttempt, f.o.activeAttempt);
    assert.equal(
      (
        f.s.native.prepare('SELECT COUNT(*) n FROM orders').get() as {
          n: number;
        }
      ).n,
      1
    );
  } finally {
    f.s.close();
  }
});
test('Unknown creation older than 23h is held for review, never automatically creates second payment', async () => {
  const f = fixture();
  try {
    f.break(true);
    await f.service.start(f.o.id, 'owner');
    f.advance(23 * 60 * 60_000);
    f.break(false);
    const o = await f.service.start(f.o.id, 'owner');
    assert.equal(o.status, 'pending');
    assert.ok(o.paymentError?.includes('разработчиком'));
    assert.equal(f.calls(), 1);
  } finally {
    f.s.close();
  }
});
test('Provider identifiers and frozen request persist across database restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-payments-'));
  const path = join(dir, 'orders.sqlite');
  const f = fixture(path);
  try {
    await f.service.start(f.o.id, 'owner');
    f.s.close();
    const restored = new ShopStore(path);
    try {
      assert.equal(restored.get(f.o.id, 'owner').mode, 'yookassa_test');
      assert.ok(restored.get(f.o.id, 'owner').confirmationUrl);
      const row = restored.native
        .prepare('SELECT provider_id FROM provider_payments')
        .get() as { provider_id: string };
      assert.equal(row.provider_id, f.paymentId);
    } finally {
      restored.close();
    }
  } finally {
    if (f.s.native.open) f.s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
