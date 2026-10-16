import { loadEnvConfig } from '@next/env';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
loadEnvConfig(process.cwd());
async function main() {
  const {
    appStore: getStore,
    rows,
    execute,
  } = await import('../src/server/app-store');
  const { PgShopStore } = await import('../src/server/pg-store');
  const { closePg } = await import('../src/server/postgres');
  const { passwordHash } = await import('../src/server/admin-auth');
  const store = getStore();
  if ((await rows(store, 'SELECT 1 FROM admin_account')).length) {
    console.log('Admin already configured. Change password in /admin.');
    if (store instanceof PgShopStore) await closePg();
    else store.close();
    return;
  }
  const password = randomBytes(18).toString('base64url'),
    encoded = passwordHash(password);
  await execute(store, 'INSERT INTO admin_account VALUES(1,?)', encoded);
  let env = '';
  try {
    env = readFileSync('.env.local', 'utf8');
  } catch {}
  const line = 'ADMIN_PASSWORD_HASH=' + encoded;
  env = /^ADMIN_PASSWORD_HASH=/m.test(env)
    ? env.replace(/^ADMIN_PASSWORD_HASH=.*$/m, line)
    : env + '\n' + line + '\n';
  writeFileSync('.env.local', env);
  mkdirSync('.qa', { recursive: true });
  writeFileSync(
    '.qa/admin-access.txt',
    'Вход: http://127.0.0.1:3000/admin\nАккаунт: admin\nВременный пароль: ' +
      password +
      '\n\nПосле входа смените пароль в разделе «Доступ» и удалите этот файл.\n'
  );
  if (store instanceof PgShopStore) await closePg();
  else store.close();
  console.log(
    'Admin configured. Temporary password saved in .qa/admin-access.txt. Never commit this file.'
  );
}
main().catch(() => {
  console.error('Admin setup failed. Check database access.');
  process.exitCode = 1;
});
