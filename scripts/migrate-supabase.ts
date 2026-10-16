import { loadEnvConfig } from '@next/env';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { Client, escapeLiteral } from 'pg';
loadEnvConfig(process.cwd());
if (process.env.MIGRATION_DATABASE_URL)
  process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
else if (process.env.DATABASE_URL) {
  const u = new URL(process.env.DATABASE_URL);
  if (u.hostname.endsWith('.pooler.supabase.com') && u.port === '6543') {
    u.port = '5432';
    process.env.DATABASE_URL = u.href;
  }
}
const tables = [
  'schema_versions',
  'inventory',
  'orders',
  'attempts',
  'request_limits',
  'mail_outbox',
  'payment_modes',
  'provider_payments',
  'catalog',
  'inventory_versions',
  'admin_account',
];
async function main() {
  const { postgresConfig } = await import('../src/server/postgres');
  const client = new Client({ ...postgresConfig(), query_timeout: 30000 });
  client.on('error', () => {});
  try {
    const path = resolve(process.env.DATABASE_PATH || './data/shop.sqlite');
    if (!existsSync(path)) throw Error('SQLITE_SOURCE_MISSING');
    mkdirSync('.qa', { recursive: true });
    const snapshot = join('.qa', 'before-supabase-' + randomUUID() + '.sqlite');
    const live = new Database(path, { readonly: true, fileMustExist: true });
    try {
      await live.backup(snapshot);
    } finally {
      live.close();
    }
    const source = new Database(snapshot, {
      readonly: true,
      fileMustExist: true,
    });
    const data: Record<string, Record<string, unknown>[]> = {};
    try {
      for (const name of tables)
        data[name] = source
          .prepare(
            'SELECT * FROM ' +
              name +
              (name === 'catalog' ? ' ORDER BY rowid' : '')
          )
          .all() as Record<string, unknown>[];
    } finally {
      source.close();
    }
    const counts = Object.fromEntries(tables.map((t) => [t, data[t].length]));
    await client.connect();
    console.log('Verified connection ready');
    for (const statement of readFileSync('deploy/supabase-schema.sql', 'utf8')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await client.query(statement);
    console.log('Schema ready');
    await client.query('BEGIN');
    await client.query("SET LOCAL idle_in_transaction_session_timeout='20s'");
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query('LOCK TABLE shop.import_history IN EXCLUSIVE MODE');
    if (
      (
        await client.query(
          "SELECT 1 FROM shop.import_history WHERE id='sqlite-import-v1'"
        )
      ).rowCount
    )
      throw Error('IMPORT_ALREADY_COMPLETED');
    for (const name of tables)
      if (
        (await client.query('SELECT 1 FROM shop.' + name + ' LIMIT 1')).rowCount
      )
        throw Error('SHOP_NOT_EMPTY');
    for (const name of tables) {
      const rows = data[name];
      for (const row of rows) {
        const keys = Object.keys(row);
        if (keys.some((k) => !/^[_a-z]+$/.test(k)))
          throw Error('INVALID_SOURCE_COLUMN');
        await client.query(
          'INSERT INTO shop.' +
            name +
            '(' +
            keys.join(',') +
            ') VALUES(' +
            keys.map((_, i) => '$' + (i + 1)).join(',') +
            ')',
          Object.values(row)
        );
      }
      console.log('Copied table:', name, rows.length);
    }
    await client.query('INSERT INTO shop.import_history VALUES($1,$2,$3)', [
      'sqlite-import-v1',
      Date.now(),
      JSON.stringify(counts),
    ]);
    await client.query('COMMIT');
    console.log('Import committed. Row counts only:', counts);
    console.log(
      'Local SQLite preserved. Administrator sessions were not copied.'
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    const e = error as { code?: string; message?: string };
    console.error(
      'Import network category:',
      /timeout/i.test(e.message || '')
        ? 'timeout'
        : /terminated/i.test(e.message || '')
          ? 'terminated'
          : 'other'
    );
    console.error(
      'Import not completed:',
      e.code ||
        ([
          'SQLITE_SOURCE_MISSING',
          'INVALID_SOURCE_COLUMN',
          'DATABASE_URL_MISSING',
          'SUPABASE_CA_CERT_MISSING',
        ].includes(e.message || '')
          ? e.message
          : 'CONNECTION_OR_IMPORT_FAILED')
    );
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}
void main();
