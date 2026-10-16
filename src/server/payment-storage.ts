import type Database from 'better-sqlite3';
export function migratePayments(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS payment_modes(order_id TEXT PRIMARY KEY REFERENCES orders(id), mode TEXT NOT NULL CHECK(mode='yookassa_test'));
    CREATE TABLE IF NOT EXISTS provider_payments(attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),order_id TEXT NOT NULL REFERENCES orders(id), request TEXT NOT NULL, first_request INTEGER NOT NULL, provider_id TEXT UNIQUE, confirmation_url TEXT, checked_at INTEGER NOT NULL DEFAULT 0, error TEXT);
    INSERT OR IGNORE INTO schema_versions(version) VALUES(3);
  `);
}
