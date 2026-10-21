import { PgShopStore } from '@/server/pg-store';
import { appStore as getStore } from '@/server/app-store';
import { cookies } from 'next/headers';
import { body, respond, ShopError } from '@/server/http';
import {
  requireAdmin,
  adminCookie,
  adminCookieSet,
} from '@/server/admin-session';
import { login, logout, changePassword } from '@/server/admin-auth';
import { adminProducts, saveProduct } from '@/server/catalog-store';
import { saveImage, validStoredImagePath } from '@/server/uploads';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  return respond(async () => {
    await requireAdmin();
    const store = getStore(),
      action = (await params).action;
    if (action === 'products')
      return {
        products:
          store instanceof PgShopStore
            ? await store.adminProducts()
            : adminProducts(store),
      };
    if (action === 'orders') {
      const id = new URL(request.url).searchParams.get('id');
      if (store instanceof PgShopStore)
        return id
          ? { order: await store.adminOrders(id) }
          : { orders: await store.adminOrders() };
      if (id) {
        const row = store.native
          .prepare(
            'SELECT id,number,status,items,customer,subtotal,shipping,total,delivery_label,created_at FROM orders WHERE id=?'
          )
          .get(id) as Record<string, unknown> | undefined;
        if (!row) throw new ShopError(404, 'Заказ не найден.');
        return {
          order: {
            ...row,
            items: JSON.parse(row.items as string),
            customer: JSON.parse(row.customer as string),
          },
        };
      }
      return {
        orders: store.native
          .prepare(
            'SELECT id,number,status,total,created_at FROM orders ORDER BY created_at DESC LIMIT 100'
          )
          .all(),
      };
    }
    throw new ShopError(404, 'Раздел не найден.');
  });
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> }
) {
  return respond(async () => {
    const action = (await params).action,
      store = getStore();
    if (action === 'login') {
      const value = await body(request);
      if (value.privacyConsent !== true)
        throw new ShopError(400, 'Подтвердите согласие на обработку данных.');
      const token =
        store instanceof PgShopStore
          ? await store.login(value.password)
          : login(store.native, value.password);
      if (!token) throw new ShopError(401, 'Неверный пароль.');
      await adminCookieSet(token);
      return { ok: true };
    }
    await requireAdmin();
    if (action === 'upload') {
      if (request.headers.get('x-privacy-consent') !== 'true')
        throw new ShopError(400, 'Подтвердите согласие на обработку данных.');
      const origin = new URL(process.env.APP_URL || 'http://127.0.0.1:3000')
        .origin;
      if (request.headers.get('origin') !== origin)
        throw new ShopError(403, 'Запрос с другого сайта запрещён.');
      const reader = request.body?.getReader();
      if (!reader) throw new ShopError(400, 'Выберите файл.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const p = await reader.read();
        if (p.done) break;
        size += p.value.length;
        if (size > 4_000_000) {
          await reader.cancel();
          throw new ShopError(413, 'Максимум 4 МБ.');
        }
        chunks.push(p.value);
      }
      return { url: await saveImage(Buffer.concat(chunks)) };
    }
    const value = await body(request);
    if (action === 'logout') {
      const jar = await cookies();
      if (store instanceof PgShopStore)
        await store.logout(jar.get(adminCookie)?.value || '');
      else logout(store.native, jar.get(adminCookie)?.value || '');
      await adminCookieSet('');
      return { ok: true };
    }
    if (action === 'password') {
      if (value.privacyConsent !== true)
        throw new ShopError(400, 'Подтвердите согласие на обработку данных.');
      if (store instanceof PgShopStore)
        await store.changePassword(value.current, value.next);
      else changePassword(store.native, value.current, value.next);
      await adminCookieSet('');
      return { ok: true };
    }
    if (action === 'save') {
      if (value.privacyConsent !== true)
        throw new ShopError(400, 'Подтвердите согласие на обработку данных.');
      if (
        !Array.isArray(value.gallery) ||
        !(
          await Promise.all(
            value.gallery.map((p) =>
              typeof p === 'string' ? validStoredImagePath(p) : false
            )
          )
        ).every(Boolean)
      )
        throw new ShopError(400, 'Загрузите фотографии через админку.');
      return {
        product:
          store instanceof PgShopStore
            ? await store.saveProduct(value)
            : saveProduct(store, value),
      };
    }
    throw new ShopError(404, 'Действие не найдено.');
  });
}
