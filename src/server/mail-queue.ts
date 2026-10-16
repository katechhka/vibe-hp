import type Database from 'better-sqlite3';
import { receiptContent, type ReceiptOrder } from './receipt';
import type { ReceiptStatus } from '../lib/order-types';
export type MailRow = {
  order_id: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'review';
  payload: string;
  sender: string | null;
  attempts: number;
  first_attempt: number | null;
  lease_until: number;
  next_attempt: number;
  provider_id: string | null;
  last_error: string | null;
};
export function migrateMail(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS mail_outbox(
 order_id TEXT PRIMARY KEY REFERENCES orders(id),
 status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','failed','review')),
 payload TEXT NOT NULL,sender TEXT,attempts INTEGER NOT NULL DEFAULT 0,
 first_attempt INTEGER,lease_until INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,
 provider_id TEXT,last_error TEXT);
 INSERT OR IGNORE INTO schema_versions(version) VALUES(2);`);
}
export function enqueueReceipt(db: Database.Database, order: ReceiptOrder) {
  db.prepare(
    "INSERT OR IGNORE INTO mail_outbox(order_id,status,payload) VALUES(?,'pending',?)"
  ).run(order.id, JSON.stringify(receiptContent(order)));
}
export function mailConfigured() {
  return (
    process.env.EMAIL_MODE === 'resend' &&
    !!process.env.RESEND_API_KEY?.trim() &&
    !!process.env.EMAIL_FROM?.trim()
  );
}
export function receiptStatus(
  db: Database.Database,
  id: string
): ReceiptStatus {
  const row = db
    .prepare('SELECT status FROM mail_outbox WHERE order_id=?')
    .get(id) as { status: MailRow['status'] } | undefined;
  if (!row) return 'not_requested';
  if (row.status === 'sent') return 'sent';
  if (!mailConfigured()) return 'not_configured';
  if (row.status === 'sending') return 'pending';
  return row.status;
}
export function claimMail(
  db: Database.Database,
  id: string,
  sender: string,
  now = Date.now()
) {
  return db
    .transaction(() => {
      const row = db
        .prepare('SELECT * FROM mail_outbox WHERE order_id=?')
        .get(id) as MailRow | undefined;
      if (
        !row ||
        row.status === 'sent' ||
        row.status === 'review' ||
        row.lease_until > now ||
        row.next_attempt > now
      )
        return null;
      if (
        row.first_attempt !== null &&
        now - row.first_attempt >= 23 * 60 * 60_000
      ) {
        db.prepare(
          "UPDATE mail_outbox SET status='review',lease_until=0,last_error='idempotency_window_expired' WHERE order_id=?"
        ).run(id);
        return null;
      }
      if (row.attempts >= 5) {
        db.prepare(
          "UPDATE mail_outbox SET status='review',lease_until=0,last_error='attempt_limit' WHERE order_id=?"
        ).run(id);
        return null;
      }
      db.prepare(
        "UPDATE mail_outbox SET status='sending',sender=COALESCE(sender,?),first_attempt=COALESCE(first_attempt,?),attempts=attempts+1,lease_until=?,last_error=NULL WHERE order_id=?"
      ).run(sender, now, now + 120_000, id);
      return db
        .prepare('SELECT * FROM mail_outbox WHERE order_id=?')
        .get(id) as MailRow;
    })
    .immediate();
}
export function finishMail(
  db: Database.Database,
  row: MailRow,
  providerId: string | null,
  errorCode: string | null,
  now = Date.now()
) {
  const delay = Math.min(
    15 * 60_000,
    60_000 * 2 ** Math.max(0, row.attempts - 1)
  );
  db.prepare(
    "UPDATE mail_outbox SET status=?,provider_id=?,last_error=?,lease_until=0,next_attempt=? WHERE order_id=? AND status='sending' AND attempts=?"
  ).run(
    providerId ? 'sent' : 'failed',
    providerId,
    errorCode,
    providerId ? 0 : now + delay,
    row.order_id,
    row.attempts
  );
}
