import {
  cloudStorage,
  putCloudImage,
  readCloudImage,
  cloudImageExists,
} from './cloud-storage';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { ShopError } from './store';
export const uploadsPath = () =>
  resolve(
    /* turbopackIgnore: true */ process.env.UPLOADS_PATH || './data/uploads'
  );
export async function saveImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > (cloudStorage() ? 4_000_000 : 8_000_000))
    throw new ShopError(413, 'Изображение должно быть не больше 8 МБ.');
  let encoded: Buffer;
  try {
    const image = sharp(bytes, {
      limitInputPixels: 20_000_000,
      animated: false,
    });
    const meta = await image.metadata();
    if (
      !['jpeg', 'png', 'webp', 'avif', 'heif'].includes(meta.format || '') ||
      !meta.width ||
      !meta.height ||
      meta.width < 300 ||
      meta.height < 300
    )
      throw Error();
    encoded = await image
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new ShopError(
      400,
      'Нужен JPEG, PNG, WebP или AVIF размером от 300 × 300 px.'
    );
  }
  const name = createHash('sha256').update(encoded).digest('hex') + '.webp';
  if (cloudStorage()) {
    await putCloudImage(name, encoded);
    return '/media/' + name;
  }
  mkdirSync(uploadsPath(), { recursive: true });
  writeFileSync(resolve(uploadsPath(), name), encoded);
  return '/media/' + name;
}
export function readImage(name: string) {
  if (!/^[a-f0-9]{64}\.webp$/.test(name))
    throw new ShopError(404, 'Изображение не найдено.');
  const path = resolve(uploadsPath(), name);
  if (!existsSync(/* turbopackIgnore: true */ path))
    throw new ShopError(404, 'Изображение не найдено.');
  return readFileSync(/* turbopackIgnore: true */ path);
}
export function validImagePath(path: string) {
  if (/^\/media\/[a-f0-9]{64}\.webp$/.test(path))
    return existsSync(
      /* turbopackIgnore: true */ resolve(uploadsPath(), path.slice(7))
    );
  if (/^\/images\/[a-z0-9-]+\.webp$/.test(path))
    return existsSync(
      /* turbopackIgnore: true */ resolve('public', path.slice(1))
    );
  return false;
}

export async function readStoredImage(name: string) {
  return cloudStorage() ? readCloudImage(name) : readImage(name);
}
export async function validStoredImagePath(path: string) {
  if (cloudStorage() && /^\/media\/[a-f0-9]{64}\.webp$/.test(path))
    return cloudImageExists(path.slice(7));
  return validImagePath(path);
}
