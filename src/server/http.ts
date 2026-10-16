import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getStore, hash, ShopError } from './store';
const cookieName = 'ps-order-session';
export async function owner(create = false) {
  const jar = await cookies();
  let token = jar.get(cookieName)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    if (!create)
      throw new ShopError(
        404,
        'Заказ не найден или недоступен в этом браузере.'
      );
    token = randomBytes(32).toString('hex');
    jar.set(cookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure:
        new URL(process.env.APP_URL || 'http://127.0.0.1:3000').protocol ===
        'https:',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return hash(token);
}
export async function body(request: Request) {
  const origin = new URL(process.env.APP_URL || 'http://127.0.0.1:3000').origin;
  if (request.headers.get('origin') !== origin)
    throw new ShopError(403, 'Запрос с другого сайта запрещён.');
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ShopError(415, 'Ожидается JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new ShopError(400, 'Пустой запрос.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > 24_000) {
      await reader.cancel();
      throw new ShopError(413, 'Слишком большой запрос.');
    }
    chunks.push(part.value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new ShopError(400, 'Не удалось прочитать запрос.');
  }
}
export async function respond(action: () => unknown | Promise<unknown>) {
  try {
    return NextResponse.json(await action(), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    const known = error instanceof ShopError;
    return NextResponse.json(
      {
        error: known
          ? error.message
          : 'Не удалось обработать заказ. Попробуйте ещё раз.',
        fields: known ? error.fields : undefined,
      },
      {
        status: known ? error.status : 503,
        headers: { 'Cache-Control': 'private, no-store' },
      }
    );
  }
}
export { getStore, ShopError };
