import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ShopStore } from './store';
import { initialCheckout } from '../lib/checkout';
import { claimMail, finishMail, receiptStatus } from './mail-queue';
import { deliverReceipt } from './mail';
const request = () => ({
  requestKey: randomUUID(),
  fields: {
    ...initialCheckout,
    name: 'Тестовая Ася',
    email: 'owner@example.com',
    phone: '+7 999 123-45-67',
    city: 'Москва',
    pickupAddress: 'Тестовый пункт, 3',
    consent: true,
    demo: true,
  },
  items: [
    {
      id: 'ps-008',
      variant: 'В точку',
      quantity: 2,
      lots: [{ key: randomUUID(), quantity: 2 }],
    },
  ],
  expectedTotal: 373000,
});
const paid = (s: ShopStore) => {
  const o = s.create(request(), 'owner');
  return s.resolve(o.id, 'owner', o.activeAttempt, 'succeeded');
};
test('Receipt only appears after success; one durable entry for repeated success', () => {
  const s = new ShopStore(':memory:');
  try {
    const o = s.create(request(), 'owner');
    assert.equal(
      (
        s.native.prepare('SELECT count(*) AS n FROM mail_outbox').get() as {
          n: number;
        }
      ).n,
      0
    );
    s.resolve(o.id, 'owner', o.activeAttempt, 'failed');
    assert.equal(
      (
        s.native.prepare('SELECT count(*) AS n FROM mail_outbox').get() as {
          n: number;
        }
      ).n,
      0
    );
    const retry = s.retry(o.id, 'owner', randomUUID());
    s.resolve(o.id, 'owner', retry.activeAttempt, 'succeeded');
    s.resolve(o.id, 'owner', retry.activeAttempt, 'succeeded');
    assert.equal(
      (
        s.native.prepare('SELECT count(*) AS n FROM mail_outbox').get() as {
          n: number;
        }
      ).n,
      1
    );
  } finally {
    s.close();
  }
});
test('Receipt contains exact snapshot, quantities, prices and demo notice but no phone/address', () => {
  const s = new ShopStore(':memory:');
  try {
    const o = paid(s);
    const row = s.native
      .prepare('SELECT payload FROM mail_outbox WHERE order_id=?')
      .get(o.id) as { payload: string };
    const mail = JSON.parse(row.payload);
    assert.deepEqual(mail.to, ['owner@example.com']);
    assert.match(mail.subject, new RegExp(o.number));
    assert.match(mail.text, /Ночная библиотека — В точку: 2 шт\./);
    assert.match(mail.text, /Итого: 3\s730 ₽/);
    assert.match(mail.text, /Настоящие деньги не списывались/);
    assert.ok(!mail.text.includes('+7'));
    assert.ok(!mail.text.includes('Тестовый пункт'));
    assert.ok(!('email' in o));
    assert.ok(!JSON.stringify(o).includes('owner@example.com'));
  } finally {
    s.close();
  }
});
test('Concurrent workers share lease, and repeated processing cannot resend accepted receipt', () => {
  const s = new ShopStore(':memory:');
  try {
    const o = paid(s);
    const a = claimMail(s.native, o.id, 'sender@example.com', 1000)!;
    assert.ok(a);
    assert.equal(claimMail(s.native, o.id, 'sender@example.com', 1001), null);
    finishMail(s.native, a, 'provider-id', null, 2000);
    assert.equal(claimMail(s.native, o.id, 'sender@example.com', 2001), null);
    assert.equal(receiptStatus(s.native, o.id), 'sent');
  } finally {
    s.close();
  }
});
test('Retry freezes sender/payload; abandoned lease recovers and stale completion is ignored', () => {
  const s = new ShopStore(':memory:');
  try {
    const o = paid(s);
    const a = claimMail(s.native, o.id, 'original@example.com', 1000)!;
    const b = claimMail(s.native, o.id, 'changed@example.com', 122000)!;
    assert.ok(b);
    assert.equal(b.sender, a.sender);
    assert.equal(b.payload, a.payload);
    assert.equal(b.first_attempt, a.first_attempt);
    finishMail(s.native, a, 'old-response', null, 123000);
    assert.notEqual(receiptStatus(s.native, o.id), 'sent');
    finishMail(s.native, b, 'new-response', null, 124000);
    assert.equal(receiptStatus(s.native, o.id), 'sent');
  } finally {
    s.close();
  }
});
test('Network failure backs off and expired provider idempotency window stops automatic retry', () => {
  const s = new ShopStore(':memory:');
  try {
    const o = paid(s);
    const a = claimMail(s.native, o.id, 'sender@example.com', 1000)!;
    finishMail(s.native, a, null, 'network_or_timeout', 2000);
    assert.equal(claimMail(s.native, o.id, 'sender@example.com', 3000), null);
    assert.ok(claimMail(s.native, o.id, 'sender@example.com', 63000));
    assert.equal(
      claimMail(s.native, o.id, 'sender@example.com', 1000 + 24 * 60 * 60_000),
      null
    );
    assert.equal(
      (
        s.native
          .prepare('SELECT status FROM mail_outbox WHERE order_id=?')
          .get(o.id) as { status: string }
      ).status,
      'review'
    );
    assert.equal(s.get(o.id, 'owner').status, 'paid');
  } finally {
    s.close();
  }
});
test('Resend adapter uses server credential, fixed idempotency key, correct recipient and sends once', async () => {
  const saved = {
    mode: process.env.EMAIL_MODE,
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
  };
  process.env.EMAIL_MODE = 'resend';
  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'Письма и звёзды <onboarding@resend.dev>';
  const s = new ShopStore(':memory:');
  try {
    const o = paid(s);
    let calls = 0;
    const mock: typeof fetch = async (url, options) => {
      calls++;
      assert.equal(url, 'https://api.resend.com/emails');
      const headers = options!.headers as Record<string, string>;
      assert.equal(headers.Authorization, 'Bearer test-key');
      assert.equal(headers['Idempotency-Key'], 'order-receipt/' + o.id);
      const payload = JSON.parse(options!.body as string);
      assert.deepEqual(payload.to, ['owner@example.com']);
      return new Response(JSON.stringify({ id: 'resend-id' }), { status: 200 });
    };
    await Promise.all(
      Array.from({ length: 5 }, () => deliverReceipt(o.id, mock, s))
    );
    assert.equal(calls, 1);
    assert.equal(s.get(o.id, 'owner').emailStatus, 'sent');
  } finally {
    s.close();
    for (const [key, value] of [
      ['EMAIL_MODE', saved.mode],
      ['RESEND_API_KEY', saved.key],
      ['EMAIL_FROM', saved.from],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test('Provider rejection stays private and does not undo paid order', async () => {
  const saved = {
    mode: process.env.EMAIL_MODE,
    key: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM,
  };
  process.env.EMAIL_MODE = 'resend';
  process.env.RESEND_API_KEY = 'test-key';
  process.env.EMAIL_FROM = 'onboarding@resend.dev';
  const s = new ShopStore(':memory:');
  try {
    const o = paid(s);
    await deliverReceipt(
      o.id,
      async () => new Response('Private provider error', { status: 403 }),
      s
    );
    const view = s.get(o.id, 'owner');
    assert.equal(view.status, 'paid');
    assert.equal(view.emailStatus, 'failed');
    assert.ok(!JSON.stringify(view).includes('Private provider'));
    assert.equal(
      (
        s.native
          .prepare('SELECT last_error FROM mail_outbox WHERE order_id=?')
          .get(o.id) as { last_error: string }
      ).last_error,
      'provider_http_403'
    );
  } finally {
    s.close();
    for (const [key, value] of [
      ['EMAIL_MODE', saved.mode],
      ['RESEND_API_KEY', saved.key],
      ['EMAIL_FROM', saved.from],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test('Missing configuration never makes network request or claims the queue', async () => {
  const previous = process.env.EMAIL_MODE;
  process.env.EMAIL_MODE = 'disabled';
  const s = new ShopStore(':memory:');
  try {
    const o = paid(s);
    await deliverReceipt(
      o.id,
      async () => {
        throw new Error('Must not call network');
      },
      s
    );
    assert.equal(s.get(o.id, 'owner').emailStatus, 'not_configured');
    assert.equal(
      (
        s.native
          .prepare('SELECT attempts FROM mail_outbox WHERE order_id=?')
          .get(o.id) as { attempts: number }
      ).attempts,
      0
    );
  } finally {
    s.close();
    if (previous === undefined) delete process.env.EMAIL_MODE;
    else process.env.EMAIL_MODE = previous;
  }
});
