import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
const root = process.cwd(),
  qa = resolve(root, '.qa');
mkdirSync(qa, { recursive: true });
const db = join(qa, 'orders-' + randomUUID() + '.sqlite');
const port = process.env.TEST_SERVER_PORT || '3002',
  base = 'http://127.0.0.1:' + port;
const env = {
  ...process.env,
  NEXT_DIST_DIR: '.qa/next-orders',
  DATABASE_PATH: db,
  APP_URL: base,
  PAYMENT_MODE: 'demo',
  EMAIL_MODE: 'disabled',
};
let server;
const start = () => {
  server = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      port,
    ],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
  );
  server.stdout.on('data', () => {});
  server.stderr.on('data', (data) => {
    const message = data.toString();
    if (
      message.includes('EADDRINUSE') ||
      message.includes('Unable to acquire lock')
    )
      process.stderr.write(message);
  });
};
const stop = () => {
  if (!server?.pid) return;
  try {
    if (process.platform === 'win32')
      execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    else server.kill('SIGTERM');
  } catch {}
};
async function ready() {
  for (let i = 0; i < 90; i++) {
    if (server.exitCode !== null)
      throw new Error('Test server stopped before startup');
    try {
      const r = await fetch(base + '/api/stock');
      if (r.ok) return;
    } catch {}
    await pause(500);
  }
  throw new Error('Test server did not become ready');
}
try {
  try {
    await fetch(base + '/api/stock');
    throw new Error(
      'Port ' +
        port +
        ' is already in use. Set TEST_SERVER_PORT to a free port.'
    );
  } catch (e) {
    if (e.message?.includes('already in use')) throw e;
  }
  console.log('Starting isolated order test server at ' + base);
  start();
  await ready();
  await new Promise((res, rej) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/check-orders.mts'],
      {
        cwd: root,
        env: { ...env, TEST_BASE_URL: base },
        stdio: 'inherit',
        windowsHide: true,
      }
    );
    child.on('error', rej);
    child.on('exit', (code) =>
      code === 0 ? res() : rej(new Error('Order browser check failed'))
    );
  });
  stop();
  await pause(700);
  console.log('Restarting server to verify persistent paid status');
  start();
  await ready();
  const { request } = await import('@playwright/test');
  const context = await request.newContext({
    baseURL: base,
    storageState: '.qa/order-restart-state.json',
  });
  const id = readFileSync('.qa/order-restart-id.txt', 'utf8');
  const response = await context.get('/api/orders/' + id);
  if (!response.ok() || (await response.json()).order.status !== 'paid')
    throw new Error('Paid order did not survive server restart');
  await context.dispose();
  const report = JSON.parse(
    readFileSync('docs/order-check-results.json', 'utf8')
  );
  report.checks.push(
    'Paid order and protected access survive a full Next.js server restart'
  );
  writeFileSync(
    'docs/order-check-results.json',
    JSON.stringify(report, null, 2)
  );
  console.log('PASS: 7 order browser scenarios including server restart');
} finally {
  stop();
  // Remove generated type paths of this isolated server from the project config.
  const configPath = resolve(root, 'tsconfig.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.include = config.include.filter(
    (p) => !p.startsWith(env.NEXT_DIST_DIR + '/')
  );
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  const nextEnvPath = resolve(root, 'next-env.d.ts');
  if (existsSync(nextEnvPath)) {
    const declarations = readFileSync(nextEnvPath, 'utf8');
    if (declarations.includes(env.NEXT_DIST_DIR))
      writeFileSync(
        nextEnvPath,
        declarations
          .replaceAll('./' + env.NEXT_DIST_DIR + '/dev/', './.next/dev/')
          .replaceAll('./' + env.NEXT_DIST_DIR + '/', './.next/')
      );
  }
  // Remove only this run's database; never touch data/shop.sqlite.
  for (const path of [db, db + '-wal', db + '-shm']) {
    if (
      !resolve(path).startsWith(
        qa + (process.platform === 'win32' ? '\\' : '/')
      )
    )
      throw new Error('Unsafe test database path');
    if (existsSync(path)) unlinkSync(path);
  }
}
