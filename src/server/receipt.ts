import { money } from '../data/catalog';
import type { OrderLine } from '../lib/order-types';
export type ReceiptOrder = {
  id: string;
  number: string;
  items: OrderLine[];
  subtotal: number;
  shipping: number;
  total: number;
  deliveryLabel: string;
  customer: { email: string };
};
export function receiptContent(order: ReceiptOrder) {
  const lines = order.items.map(
    (item) =>
      '- ' +
      item.name +
      (item.variant ? ' — ' + item.variant : '') +
      ': ' +
      item.quantity +
      ' шт. × ' +
      money(item.unitPrice / 100) +
      ' = ' +
      money((item.unitPrice * item.quantity) / 100)
  );
  return {
    to: [order.customer.email],
    subject: 'Вы совершили демозаказ № ' + order.number + ' · Письма и звёзды',
    text: [
      'Письма и звёзды',
      '',
      'Спасибо! Вы совершили демонстрационный заказ № ' + order.number + '.',
      'Успешная демооплата подтверждена.',
      '',
      'В вашем заказе:',
      ...lines,
      '',
      'Товары: ' + money(order.subtotal / 100),
      order.deliveryLabel + ': ' + money(order.shipping / 100),
      'Итого: ' + money(order.total / 100),
      '',
      'Это письмо из портфолио-магазина. Настоящие деньги не списывались; товары не будут изготовлены и отправлены.',
      '',
      'Спасибо, что заглянули в мастерскую!',
      'Ася, «Письма и звёзды»',
    ].join('\n'),
  };
}
