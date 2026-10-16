import { appStore, rows, type AppStore } from './app-store';
import { PgShopStore } from './pg-store';
import { claimMail, finishMail, mailConfigured } from './mail-queue';
export async function deliverReceipt(
  id: string,
  request: typeof fetch = fetch,
  store?: AppStore
) {
  if (!mailConfigured()) return;
  const selected = store || appStore();
  const claim = () =>
    selected instanceof PgShopStore
      ? selected.claimMail(id, process.env.EMAIL_FROM!.trim())
      : claimMail(selected.native, id, process.env.EMAIL_FROM!.trim());
  const finish = (
    row: import('./mail-queue').MailRow,
    providerId: string | null,
    error: string | null
  ) =>
    selected instanceof PgShopStore
      ? selected.finishMail(row, providerId, error)
      : finishMail(selected.native, row, providerId, error);
  const row = await claim();
  if (!row) return;
  try {
    const response = await request('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'order-receipt/' + id,
      },
      body: JSON.stringify({ from: row.sender, ...JSON.parse(row.payload) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      await finish(row, null, 'provider_http_' + response.status);
      return;
    }
    const data = await response.json();
    if (typeof data?.id !== 'string' || !data.id) {
      await finish(row, null, 'invalid_provider_response');
      return;
    }
    await finish(row, data.id, null);
  } catch {
    await finish(row, null, 'network_or_timeout');
  }
}
export async function flushReceipts() {
  if (!mailConfigured())
    throw new Error(
      'Set EMAIL_MODE=resend, RESEND_API_KEY and EMAIL_FROM on the server.'
    );
  const store = appStore();
  const due = await rows<{ order_id: string }>(
    store,
    "SELECT order_id FROM mail_outbox WHERE status IN ('pending','failed','sending') AND next_attempt<=? AND lease_until<=? LIMIT 20",
    Date.now(),
    Date.now()
  );
  for (const row of due) await deliverReceipt(row.order_id);
  return due.length;
}
