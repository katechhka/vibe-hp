import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
async function main() {
  const { appStore: getStore, rows: queryRows } =
    await import('../src/server/app-store');
  const { PgShopStore } = await import('../src/server/pg-store');
  const { closePg } = await import('../src/server/postgres');
  const { Payments } = await import('../src/server/payments');
  const { deliverReceipt } = await import('../src/server/mail');
  const store = getStore(),
    payments = new Payments(store);
  const rows = await queryRows<{ id: string; owner: string }>(
    store,
    "SELECT o.id,o.owner FROM orders o JOIN payment_modes m ON m.order_id=o.id WHERE o.status='pending' LIMIT 50"
  );
  let checked = 0,
    paid = 0;
  for (const row of rows) {
    const result = await payments.start(row.id, row.owner);
    checked++;
    if (result.status === 'paid') {
      paid++;
      await deliverReceipt(result.id);
    }
  }
  console.log('Checked test orders:', checked, 'Confirmed:', paid);
  if (store instanceof PgShopStore) await closePg();
  else store.close();
}
main().catch(() => {
  console.error('Could not synchronize test payments. See docs/payments.md.');
  process.exitCode = 1;
});
