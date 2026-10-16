import { loadEnvConfig } from '@next/env';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
loadEnvConfig(process.cwd());
async function main() {
  const { ensureImageBucket, putCloudImage, readCloudImage } =
    await import('../src/server/cloud-storage');
  const root = resolve(process.env.UPLOADS_PATH || './data/uploads');
  await ensureImageBucket();
  let count = 0;
  if (existsSync(root))
    for (const name of readdirSync(root).filter((n) =>
      /^[a-f0-9]{64}\.webp$/.test(n)
    )) {
      const bytes = readFileSync(join(root, name));
      if (createHash('sha256').update(bytes).digest('hex') + '.webp' !== name)
        throw Error('INVALID_IMAGE_HASH');
      await putCloudImage(name, bytes);
      const downloaded = await readCloudImage(name);
      if (!downloaded.equals(bytes)) throw Error('STORAGE_VERIFICATION_FAILED');
      count++;
    }
  console.log('Uploaded and verified immutable photographs:', count);
}
main().catch(() => {
  console.error('Photo migration failed. No local files were removed.');
  process.exitCode = 1;
});
