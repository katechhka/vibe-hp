import { getStore, ShopError, type ShopStore } from './store';
import { PgShopStore } from './pg-store';
export type AppStore = ShopStore | PgShopStore;
export const usePostgres = () => process.env.DB_DRIVER === 'supabase';
export function appStore(): AppStore {
  if (
    process.env.DB_DRIVER &&
    !['sqlite', 'supabase'].includes(process.env.DB_DRIVER)
  )
    throw new ShopError(503, 'Неизвестный режим базы данных.');
  if (
    process.env.VERCEL &&
    (process.env.DB_DRIVER !== 'supabase' ||
      process.env.STORAGE_DRIVER !== 'supabase')
  )
    throw new ShopError(
      503,
      'Для Vercel необходимо настроить Supabase для базы и фотографий.'
    );
  if (
    process.env.PAYMENT_MODE &&
    !['demo', 'yookassa_test'].includes(process.env.PAYMENT_MODE)
  )
    throw new ShopError(503, 'Доступна только тестовая оплата.');
  return usePostgres() ? new PgShopStore() : getStore();
}
// Shared SQL for the payment adapter. Anonymous parameterized statements work with transaction pooling.
export async function rows<T>(
  store: AppStore,
  sql: string,
  ...values: unknown[]
): Promise<T[]> {
  if (store instanceof PgShopStore)
    return (await store.query(pgSql(sql), values)) as T[];
  return store.native.prepare(sql).all(...values) as T[];
}
export async function execute(
  store: AppStore,
  sql: string,
  ...values: unknown[]
) {
  if (store instanceof PgShopStore) return store.execute(pgSql(sql), values);
  return store.native.prepare(sql).run(...values);
}
function pgSql(sql: string) {
  let i = 0;
  let s = sql.replace(/\?/g, () => '$' + ++i);
  if (s.includes('INSERT OR IGNORE'))
    s = s.replace('INSERT OR IGNORE', 'INSERT') + ' ON CONFLICT DO NOTHING';
  return s;
}
