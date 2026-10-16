import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { OrderLine, OrderStatus, AttemptStatus } from '../lib/order-types';
import type { CheckoutFields } from '../lib/checkout';
export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    number: text('number').notNull(),
    owner: text('owner').notNull(),
    requestKey: text('request_key').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').$type<OrderStatus>().notNull(),
    items: text('items', { mode: 'json' }).$type<OrderLine[]>().notNull(),
    customer: text('customer', { mode: 'json' })
      .$type<CheckoutFields>()
      .notNull(),
    subtotal: integer('subtotal').notNull(),
    shipping: integer('shipping').notNull(),
    total: integer('total').notNull(),
    deliveryLabel: text('delivery_label').notNull(),
    createdAt: integer('created_at').notNull(),
    reservedUntil: integer('reserved_until').notNull(),
    activeAttempt: text('active_attempt'),
  },
  (t) => [
    uniqueIndex('orders_request').on(t.owner, t.requestKey),
    uniqueIndex('orders_global_request').on(t.requestKey),
  ]
);
export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id),
    requestKey: text('request_key').notNull(),
    status: text('status').$type<AttemptStatus>().notNull(),
    createdAt: integer('created_at').notNull(),
    finishedAt: integer('finished_at'),
  },
  (t) => [uniqueIndex('attempts_request').on(t.orderId, t.requestKey)]
);
export const inventory = sqliteTable('inventory', {
  id: text('id').primaryKey(),
  remaining: integer('remaining').notNull(),
});
