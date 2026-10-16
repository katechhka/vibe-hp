import { loadEnvConfig } from '@next/env';
import Database from 'better-sqlite3';
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
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
  const { postgresConfig } = await import('../src/server/postgres');
  async function query(sql: string) {
    const c = new Client(postgresConfig());
    c.on('error', () => {});
    try {
      await c.connect();
      return (await c.query(sql)).rows;
    } finally {
      await c.end().catch(() => {});
    }
  }
  const source = new Database('.qa/supabase-source.sqlite', {
    readonly: true,
    fileMustExist: true,
  });
  try {
    if (
      !(
        await query(
          "SELECT 1 FROM shop.import_history WHERE id='sqlite-import-v1'"
        )
      ).length
    )
      throw Error('IMPORT_NOT_COMPLETED');
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const original = source.prepare('SELECT * FROM ' + table).all() as Record<
        string,
        unknown
      >[];
      const keys = source
        .prepare('PRAGMA table_info(' + table + ')')
        .all()
        .map((r) => (r as { name: string }).name);
      const local = original
        .map((row) =>
          createHash('sha256')
            .update(
              keys
                .map((k) =>
                  row[k] == null
                    ? 'N'
                    : 'V' +
                      Buffer.byteLength(String(row[k])) +
                      ':' +
                      String(row[k])
                )
                .join('')
            )
            .digest('hex')
        )
        .sort();
      const expression = keys
        .map(
          (k) =>
            'CASE WHEN ' +
            k +
            " IS NULL THEN 'N' ELSE 'V'||octet_length(" +
            k +
            "::text)::text||':'||" +
            k +
            '::text END'
        )
        .join('||');
      const cloud = (
        await query(
          'SELECT encode(sha256(convert_to(' +
            expression +
            ",'UTF8')),'hex') AS hash FROM shop." +
            table
        )
      )
        .map((r) => r.hash as string)
        .sort();
      assert.deepEqual(cloud, local, 'Snapshot mismatch: ' + table);
      counts[table] = cloud.length;
    }
    const before = source
      .prepare('SELECT id FROM catalog ORDER BY rowid')
      .all()
      .map((r) => (r as { id: string }).id);
    const after = (
      await query('SELECT id FROM shop.catalog ORDER BY position')
    ).map((r) => r.id);
    assert.deepEqual(after, before, 'Catalog order mismatch');
    const permissions = (
      await query(
        "SELECT has_schema_privilege('anon','shop','USAGE') AS anon,has_schema_privilege('authenticated','shop','USAGE') AS authenticated"
      )
    )[0];
    assert.deepEqual(permissions, { anon: false, authenticated: false });
    const path = 'docs/supabase-check-results.json';
    let report: Record<string, unknown> = {};
    try {
      report = JSON.parse(readFileSync(path, 'utf8'));
    } catch {}
    Object.assign(report, {
      liveImportVerified: true,
      liveVerifiedAt: new Date().toISOString(),
      liveChecks: [
        'Every imported field matches local snapshot SHA-256; contacts and admin password hash not exposed',
        'Catalog order preserved',
        'Schema inaccessible to anonymous/authenticated roles',
      ],
      counts,
      limitations: [
        'Serverless application and live checkout still require public deployment verification',
      ],
    });
    writeFileSync(path, JSON.stringify(report, null, 2));
    console.log(
      'PASS: live Supabase import equals the SQLite snapshot; privacy permissions verified. Counts:',
      counts
    );
  } finally {
    source.close();
  }
}
main().catch((error) => {
  const e = error as { message?: string; code?: string };
  console.error(
    'Import verification not complete:',
    e.message === 'IMPORT_NOT_COMPLETED'
      ? e.message
      : e.code || 'VERIFICATION_FAILED'
  );
  process.exitCode = 1;
});
