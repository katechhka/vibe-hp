import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
const dir = path.resolve('.qa/deploy-backup-' + Date.now());
fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
const source = path.join(dir, 'shop.sqlite');
const db = new Database(source);
db.pragma('journal_mode=WAL');
db.exec(
  "CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT); INSERT INTO orders VALUES('test-order','paid')"
);
fs.writeFileSync(
  path.join(dir, 'uploads', 'photo.webp'),
  'immutable-test-photo'
);
try {
  const env = {
    ...process.env,
    DATABASE_PATH: source,
    UPLOADS_PATH: path.join(dir, 'uploads'),
    BACKUP_PATH: path.join(dir, 'backups'),
  };
  execFileSync(process.execPath, ['scripts/backup.mjs'], {
    env,
    stdio: 'pipe',
  });
  const copy = path.join(
    dir,
    'backups',
    fs.readdirSync(path.join(dir, 'backups'))[0]
  );
  const restored = new Database(path.join(copy, 'shop.sqlite'), {
    readonly: true,
  });
  try {
    if (
      restored.prepare('SELECT status FROM orders').get().status !== 'paid' ||
      restored.pragma('integrity_check', { simple: true }) !== 'ok'
    )
      throw Error('Backup restore failed');
    if (
      fs.readFileSync(path.join(copy, 'uploads', 'photo.webp'), 'utf8') !==
      'immutable-test-photo'
    )
      throw Error('Photo missing');
  } finally {
    restored.close();
  }
  fs.writeFileSync(
    'docs/deployment-check-results.json',
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        checks: [
          'SQLite live WAL backup restores paid order and passes integrity_check',
          'Uploaded file survives backup',
        ],
        dockerVerified: false,
        limitations: [
          'Docker unavailable: build/run, Linux dependencies and HTTPS not verified',
        ],
      },
      null,
      2
    )
  );
  console.log('PASS: live WAL backup and restoration with photo');
} finally {
  db.close();
}
