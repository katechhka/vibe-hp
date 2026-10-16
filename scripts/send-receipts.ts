import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());
async function main() {
  const { flushReceipts } = await import('../src/server/mail');
  try {
    const processed = await flushReceipts();
    console.log('Processed receipt queue entries:', processed);
  } catch {
    console.error('Email service is not configured. See docs/email.md.');
    process.exitCode = 1;
  } finally {
    const { closePg } = await import('../src/server/postgres');
    await closePg();
  }
}
void main();
