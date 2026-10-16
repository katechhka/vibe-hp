import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';
import type Database from 'better-sqlite3';
import { ShopError } from './store';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function passwordHash(password: string) {
  if (password.length < 12 || password.length > 128)
    throw new ShopError(400, 'Пароль должен содержать от 12 до 128 символов.');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
export function verifyPassword(password: unknown, encoded: string) {
  if (
    typeof password !== 'string' ||
    password.length > 128 ||
    !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded)
  )
    return false;
  const [salt, key] = encoded.split(':');
  const actual = scryptSync(password, salt, 64);
  return timingSafeEqual(actual, Buffer.from(key, 'hex'));
}
export function migrateAdmin(db: Database.Database) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS admin_account(id INTEGER PRIMARY KEY CHECK(id=1),password_hash TEXT NOT NULL); CREATE TABLE IF NOT EXISTS admin_sessions(token_hash TEXT PRIMARY KEY,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS admin_login_limit(id INTEGER PRIMARY KEY,window_start INTEGER NOT NULL,count INTEGER NOT NULL); INSERT OR IGNORE INTO schema_versions VALUES(5);'
  );
  const initial = process.env.ADMIN_PASSWORD_HASH || '';
  if (/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(initial))
    db.prepare('INSERT OR IGNORE INTO admin_account VALUES(1,?)').run(initial);
}
export function login(
  db: Database.Database,
  password: unknown,
  now = Date.now()
) {
  return db
    .transaction(() => {
      const limit = db
        .prepare('SELECT window_start,count FROM admin_login_limit WHERE id=1')
        .get() as { window_start: number; count: number } | undefined;
      if (limit && now - limit.window_start < 15 * 60_000 && limit.count >= 10)
        throw new ShopError(
          429,
          'Слишком много попыток. Попробуйте через 15 минут.'
        );
      db.prepare(
        'INSERT INTO admin_login_limit VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET window_start=excluded.window_start,count=excluded.count'
      ).run(
        limit && now - limit.window_start < 15 * 60_000
          ? limit.window_start
          : now,
        limit && now - limit.window_start < 15 * 60_000 ? limit.count + 1 : 1
      );
      const account = db
        .prepare('SELECT password_hash FROM admin_account WHERE id=1')
        .get() as { password_hash: string } | undefined;
      if (!account)
        throw new ShopError(
          503,
          'Админка не настроена. Выполните npm run admin:setup.'
        );
      if (!verifyPassword(password, account.password_hash)) return null;
      db.prepare('DELETE FROM admin_login_limit').run();
      db.prepare('DELETE FROM admin_sessions WHERE expires<?').run(now);
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO admin_sessions VALUES(?,?)').run(
        digest(token),
        now + 8 * 60 * 60_000
      );
      return token;
    })
    .immediate();
}
export function authenticated(
  db: Database.Database,
  token: unknown,
  now = Date.now()
) {
  return (
    typeof token === 'string' &&
    /^[a-f0-9]{64}$/.test(token) &&
    !!db
      .prepare('SELECT 1 FROM admin_sessions WHERE token_hash=? AND expires>?')
      .get(digest(token), now)
  );
}
export function logout(db: Database.Database, token: string) {
  db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(
    digest(token)
  );
}
export function changePassword(
  db: Database.Database,
  current: unknown,
  next: unknown
) {
  if (typeof next !== 'string')
    throw new ShopError(400, 'Введите новый пароль.');
  const encoded = passwordHash(next);
  db.transaction(() => {
    const row = db
      .prepare('SELECT password_hash FROM admin_account WHERE id=1')
      .get() as { password_hash: string };
    if (!verifyPassword(current, row.password_hash))
      throw new ShopError(400, 'Текущий пароль неверен.');
    db.prepare('UPDATE admin_account SET password_hash=? WHERE id=1').run(
      encoded
    );
    db.prepare('DELETE FROM admin_sessions').run();
  }).immediate();
}
