import { cookies } from 'next/headers';
import { ShopError } from './store';
import { appStore } from './app-store';
import { PgShopStore } from './pg-store';
import { authenticated } from './admin-auth';
export const adminCookie = 'ps-admin-session';
export async function adminAllowed() {
  const store = appStore(),
    token = (await cookies()).get(adminCookie)?.value;
  return store instanceof PgShopStore
    ? store.authenticated(token)
    : authenticated(store.native, token);
}
export async function requireAdmin() {
  if (!(await adminAllowed()))
    throw new ShopError(401, 'Войдите в мастерскую.');
}
export async function adminCookieSet(token: string) {
  (await cookies()).set(adminCookie, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure:
      new URL(process.env.APP_URL || 'http://127.0.0.1:3000').protocol ===
      'https:',
    path: '/',
    maxAge: token ? 8 * 60 * 60 : 0,
  });
}
