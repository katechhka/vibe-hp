import fs from 'node:fs/promises';
import sharp from 'sharp';
import path from 'node:path';
const sources = {
  hero: 'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-585cc469-b655-41a5-8ef6-9b2f40e60c35.png',
  workshop:
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-4a956a26-bfb0-460b-a21c-662b39c77221.png',
  letter:
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-8b80b002-67b5-43ec-a319-c265dba06311.png',
  'owl-post':
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-c53985e3-f7b3-4d29-99d0-af37125d455e.png',
  castle:
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-e74a880b-36b8-41fc-8bc7-195f3356f422.png',
  'moon-owl':
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-4dbc330e-d9dc-434f-822f-dcd1fa6b64d2.png',
  herbarium:
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-62c8441d-b756-46bd-b6b5-809a45aaf60b.png',
  orbit:
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-bfe69520-71cc-428f-b608-82b16f219a8f.png',
  'herbal-notes':
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-2e069b6a-d626-4bd1-a46d-57996ad44065.png',
  'night-library':
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-3f86362e-c319-454b-a4c7-d5036479f457.png',
  'owl-brooch':
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-b5ce939a-c519-453a-a0ce-cccd5ab91958.png',
  'moon-vial':
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-4cb1f36f-c991-446a-9e93-ce1ff0d53c36.png',
  constellation:
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-2f77b2c2-e434-43b4-908d-51f731357ef5.png',
  'first-letter':
    'C:/Users/ekalinina/.codex/generated_images/01a12f69-f9d5-7fe1-9063-4677b35e3828/exec-6a85b3a4-1393-43a5-b285-578b749e1fe2.png',
};
await fs.mkdir('public/images', { recursive: true });
await fs.mkdir('assets/originals', { recursive: true });
const products = Object.keys(sources).filter(
  (key) => !['hero', 'workshop'].includes(key)
);
for (const [name, source] of Object.entries(sources)) {
  await fs.copyFile(source, path.join('assets/originals', name + '.png'));
  if (products.includes(name)) {
    await sharp(source)
      .resize(1000, 1250, { fit: 'cover', position: 'centre' })
      .webp({ quality: 86 })
      .toFile('public/images/' + name + '.webp');
    const { width, height } = await sharp(source).metadata();
    const cropWidth = Math.round(width * 0.55),
      cropHeight = Math.round(height * 0.7);
    await sharp(source)
      .extract({
        left: Math.round((width - cropWidth) / 2),
        top: Math.round((height - cropHeight) / 2),
        width: cropWidth,
        height: cropHeight,
      })
      .resize(1000, 1250, { fit: 'cover' })
      .webp({ quality: 86 })
      .toFile('public/images/' + name + '-detail.webp');
  } else {
    await sharp(source)
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 87 })
      .toFile('public/images/' + name + '.webp');
  }
}
const tiles = await Promise.all(
  products.map(async (name, i) => {
    const thumbnail = await sharp('public/images/' + name + '.webp')
      .resize(240, 300)
      .toBuffer();
    return {
      input: thumbnail,
      left: (i % 4) * 240,
      top: Math.floor(i / 4) * 300,
    };
  })
);
await fs.mkdir('.qa', { recursive: true });
await sharp({
  create: { width: 960, height: 900, channels: 3, background: '#f7f3ea' },
})
  .composite(tiles)
  .png()
  .toFile('.qa/products-contact-sheet.png');
console.log('Prepared 26 WebP assets and product contact sheet.');
