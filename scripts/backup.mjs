import Database from 'better-sqlite3';
import { mkdirSync, cpSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import nextEnv from '@next/env';
const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());
if (process.env.DB_DRIVER === 'supabase')
  throw Error(
    'Use a PostgreSQL backup for Supabase; the local SQLite file is not the cloud database.'
  );
const source = resolve(process.env.DATABASE_PATH || './data/shop.sqlite');
const uploads = resolve(process.env.UPLOADS_PATH || './data/uploads');
const target = join(
  resolve(process.env.BACKUP_PATH || './data/backups'),
  new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8)
);
if (!existsSync(source))
  throw Error('Database does not exist; backup not created.');
mkdirSync(target, { recursive: true });
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(join(target, 'shop.sqlite'));
  // Uploads are immutable and never deleted: copy after the database snapshot.
  if (existsSync(uploads))
    cpSync(uploads, join(target, 'uploads'), { recursive: true, force: false });
  writeFileSync(
    join(target, 'manifest.json'),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        schema: 1,
        contains: ['shop.sqlite', 'uploads'],
      },
      null,
      2
    )
  );
  console.log('Backup created:', target);
} finally {
  db.close();
}
