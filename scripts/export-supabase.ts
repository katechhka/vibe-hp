import { loadEnvConfig } from '@next/env';
import Database from 'better-sqlite3';
import { escapeLiteral } from 'pg';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
loadEnvConfig(process.cwd());
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
  mkdirSync('.qa', { recursive: true });
  const backup = resolve('.qa/supabase-source.sqlite');
  const live = new Database(process.env.DATABASE_PATH || './data/shop.sqlite', {
    readonly: true,
    fileMustExist: true,
  });
  try {
    await live.backup(backup);
  } finally {
    live.close();
  }
  const source = new Database(backup, { readonly: true, fileMustExist: true });
  try {
    const statements = [
      'BEGIN',
      "SET LOCAL lock_timeout='10s'",
      readFileSync('deploy/supabase-schema.sql', 'utf8'),
      'LOCK TABLE shop.import_history IN EXCLUSIVE MODE',
      "DO $$ BEGIN IF EXISTS(SELECT 1 FROM shop.import_history WHERE id='sqlite-import-v1') THEN RAISE EXCEPTION 'IMPORT_ALREADY_COMPLETED'; END IF; END $$",
    ];
    const counts: Record<string, number> = {};
    for (const table of tables)
      statements.push(
        'DO $$ BEGIN IF EXISTS(SELECT 1 FROM shop.' +
          table +
          ") THEN RAISE EXCEPTION 'SHOP_NOT_EMPTY'; END IF; END $$"
      );
    for (const table of tables) {
      const rows = source
        .prepare(
          'SELECT * FROM ' +
            table +
            (table === 'catalog' ? ' ORDER BY rowid' : '')
        )
        .all() as Record<string, unknown>[];
      counts[table] = rows.length;
      if (!rows.length) continue;
      const keys = Object.keys(rows[0]);
      statements.push(
        'INSERT INTO shop.' +
          table +
          '(' +
          keys.join(',') +
          ') SELECT ' +
          keys.join(',') +
          ' FROM json_populate_recordset(NULL::shop.' +
          table +
          ',' +
          escapeLiteral(JSON.stringify(rows)) +
          '::json)'
      );
    }
    statements.push(
      'INSERT INTO shop.import_history VALUES(' +
        escapeLiteral('sqlite-import-v1') +
        ',' +
        Date.now() +
        ',' +
        escapeLiteral(JSON.stringify(counts)) +
        ')',
      'COMMIT'
    );
    writeFileSync(
      '.qa/supabase-import.sql',
      '-- PRIVATE: includes order contacts and admin password hash. Do not publish.\n' +
        statements.join(';\n') +
        ';\n'
    );
    writeFileSync(
      '.qa/supabase-source-counts.json',
      JSON.stringify(counts, null, 2)
    );
    console.log(
      'Private SQL Editor import saved in .qa/supabase-import.sql. Counts:',
      counts
    );
  } finally {
    source.close();
  }
}
main().catch(() => {
  console.error('Could not prepare SQL import; no source data changed.');
  process.exitCode = 1;
});
