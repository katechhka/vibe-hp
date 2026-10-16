// Test-process-only preload. Never imported by the application.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
if (process.env.PAYMENT_TEST_FIXTURE === '1') {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://api.yookassa.ru/v3/payments'))
      return original(input, init);
    const path = process.env.PAYMENT_FIXTURE_PATH;
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (state.unavailable)
      return Response.json({ type: 'error' }, { status: 503 });
    let payment;
    if (init?.method === 'POST') {
      const request = JSON.parse(init.body);
      const key = init.headers['Idempotence-Key'];
      payment = state.payments.find((p) => p.metadata.attempt_id === key);
      if (!payment) {
        const id = randomUUID();
        payment = {
          id,
          status: 'pending',
          paid: false,
          test: true,
          amount: request.amount,
          recipient: { account_id: '123456' },
          metadata: request.metadata,
          confirmation: {
            type: 'redirect',
            confirmation_url:
              'https://yoomoney.ru/checkout/payments/v2/contract?orderId=' + id,
          },
        };
        state.payments.push(payment);
        writeFileSync(path, JSON.stringify(state));
      }
    } else payment = state.payments.find((p) => p.id === url.split('/').at(-1));
    return payment
      ? Response.json(payment)
      : Response.json({}, { status: 404 });
  };
}
