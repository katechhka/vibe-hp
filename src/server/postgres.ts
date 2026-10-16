import { Pool, type PoolClient } from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
export function postgresConfig() {
  const value = process.env.DATABASE_URL;
  if (!value) throw Error('DATABASE_URL_MISSING');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error('DATABASE_URL_INVALID');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw Error('DATABASE_URL_INVALID');
  // pg otherwise lets URL sslmode override the explicit CA verification settings.
  for (const name of [
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'uselibpqcompat',
  ])
    url.searchParams.delete(name);
  const caPath = resolve(
    /* turbopackIgnore: true */ process.env.SUPABASE_CA_CERT_PATH ||
      './supabase-ca.crt'
  );
  if (!existsSync(/* turbopackIgnore: true */ caPath))
    throw Error('SUPABASE_CA_CERT_MISSING');
  return {
    connectionString: url.toString(),
    max: 2,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 10000,
    ssl: {
      ca: readFileSync(/* turbopackIgnore: true */ caPath, 'utf8'),
      rejectUnauthorized: true,
    },
    application_name: 'letters-and-stars',
    statement_timeout: 20000,
    query_timeout: 20000,
    keepAlive: true,
  };
}
let pool: Pool | undefined;
export function pgPool() {
  if (!pool) {
    pool = new Pool(postgresConfig());
    pool.on('error', () => {});
    pool.on('connect', (client) => {
      client.on('error', () => {});
    });
  }
  return pool;
}
export async function closePg() {
  await pool?.end();
  pool = undefined;
}
export async function pgTransaction<T>(
  action: (client: PoolClient) => Promise<T>
) {
  const client = await pgPool().connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
