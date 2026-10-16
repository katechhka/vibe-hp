import { createClient } from '@supabase/supabase-js';
import { ShopError } from './store';
const bucket = () => process.env.SUPABASE_STORAGE_BUCKET || 'product-images';
export const cloudStorage = () => process.env.STORAGE_DRIVER === 'supabase';
function client() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new ShopError(503, 'Хранилище фотографий не настроено.');
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (url, init) =>
        fetch(url, { ...init, signal: AbortSignal.timeout(15000) }),
    },
  });
}
function fileName(name: string) {
  if (!/^[a-f0-9]{64}\.webp$/.test(name))
    throw new ShopError(404, 'Изображение не найдено.');
  return name;
}
export async function ensureImageBucket() {
  const c = client(),
    name = bucket();
  const { data, error } = await c.storage.getBucket(name);
  if (!error) {
    if (data.public)
      throw new ShopError(503, 'Для фотографий требуется приватный bucket.');
    return;
  }
  const created = await c.storage.createBucket(name, {
    public: false,
    fileSizeLimit: 8000000,
    allowedMimeTypes: ['image/webp'],
  });
  if (created.error)
    throw new ShopError(503, 'Не удалось подготовить хранилище фотографий.');
}
export async function putCloudImage(name: string, bytes: Buffer) {
  const { error } = await client()
    .storage.from(bucket())
    .upload(fileName(name), bytes, {
      contentType: 'image/webp',
      cacheControl: '31536000',
      upsert: false,
    });
  if (
    error &&
    String(error.statusCode) !== '409' &&
    error.message !== 'The resource already exists'
  )
    throw new ShopError(
      503,
      'Не удалось сохранить фотографию. Повторите загрузку.'
    );
}
export async function readCloudImage(name: string) {
  const { data, error } = await client()
    .storage.from(bucket())
    .download(fileName(name));
  if (error || !data)
    throw new ShopError(
      error && ['404', '400'].includes(String(error.statusCode)) ? 404 : 503,
      'Изображение недоступно.'
    );
  return Buffer.from(await data.arrayBuffer());
}
export async function cloudImageExists(name: string) {
  const { data, error } = await client()
    .storage.from(bucket())
    .exists(fileName(name));
  if (error)
    throw new ShopError(
      503,
      'Не удалось проверить фотографию. Повторите сохранение.'
    );
  return data;
}
