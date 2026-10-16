import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
async function main() {
  const { pgPool, closePg } = await import('../src/server/postgres');
  try {
    const db = pgPool();
    await db.query('SELECT 1');
    console.log(
      'Supabase PostgreSQL: TLS verified, connection OK. No data changed.'
    );
  } catch (error) {
    const e = error as { code?: string; message?: string };
    const known = [
      'DATABASE_URL_MISSING',
      'DATABASE_URL_INVALID',
      'SUPABASE_CA_CERT_MISSING',
    ];
    console.error(
      'Supabase connection failed:',
      known.includes(e.message || '')
        ? e.message
        : e.code || 'CONNECTION_FAILED'
    );
    process.exitCode = 1;
  } finally {
    await closePg();
  }
}
void main();
