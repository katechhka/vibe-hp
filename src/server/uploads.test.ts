import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { saveImage, readImage, validImagePath } from './uploads';
test('Uploaded photo is bounded, converted to local immutable WebP and stripped of source metadata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-upload-')),
    previous = process.env.UPLOADS_PATH;
  process.env.UPLOADS_PATH = dir;
  try {
    const bytes = await sharp({
      create: { width: 2000, height: 1800, channels: 3, background: '#793d49' },
    })
      .png()
      .toBuffer();
    const url = await saveImage(bytes);
    assert.match(url, /^\/media\/[a-f0-9]{64}\.webp$/);
    assert.equal(await saveImage(bytes), url);
    const avif=await sharp(bytes).avif().toBuffer();assert.ok(await saveImage(avif));
    assert.ok(validImagePath(url));
    const image = readImage(url.slice(7)),
      meta = await sharp(image).metadata();
    assert.equal(meta.format, 'webp');
    assert.ok(meta.width! <= 1600);
    assert.equal(meta.exif, undefined);
    assert.throws(() => readImage('../shop.sqlite'));
    assert.equal(validImagePath('/media/' + 'a'.repeat(64) + '.webp'), false);
    await assert.rejects(() =>
      saveImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    );
    await assert.rejects(() => saveImage(Buffer.alloc(8_000_001)));
    await assert.rejects(() => saveImage(Buffer.from('not an image')));
  } finally {
    if (previous === undefined) delete process.env.UPLOADS_PATH;
    else process.env.UPLOADS_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
