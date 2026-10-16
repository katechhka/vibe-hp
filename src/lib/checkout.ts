import { deliveryOptions, products, type Product } from '../data/catalog';
import { cartSubtotal, type CartLine } from './cart';
export type CheckoutFields = {
  name: string;
  email: string;
  phone: string;
  city: string;
  pickupAddress: string;
  courierAddress: string;
  comment: string;
  delivery: 'pickup' | 'courier';
  consent: boolean;
  demo: boolean;
};
export type CheckoutErrors = Partial<Record<keyof CheckoutFields, string>>;
export const initialCheckout: CheckoutFields = {
  name: '',
  email: '',
  phone: '',
  city: '',
  pickupAddress: '',
  courierAddress: '',
  comment: '',
  delivery: 'pickup',
  consent: false,
  demo: false,
};
export const fieldLimits = {
  name: 80,
  email: 254,
  phone: 30,
  city: 100,
  pickupAddress: 300,
  courierAddress: 300,
  comment: 1000,
};
export function restoreDraft(value: unknown): CheckoutFields {
  const clean = { ...initialCheckout };
  if (!value || typeof value !== 'object') return clean;
  const saved = value as Record<string, unknown>;
  for (const key of Object.keys(fieldLimits) as (keyof typeof fieldLimits)[]) {
    const text = saved[key];
    if (typeof text === 'string') clean[key] = text.slice(0, fieldLimits[key]);
  }
  if (saved.delivery === 'courier') clean.delivery = 'courier';
  if (
    typeof saved.address === 'string' &&
    !clean.pickupAddress &&
    !clean.courierAddress
  )
    clean[clean.delivery === 'pickup' ? 'pickupAddress' : 'courierAddress'] =
      saved.address.slice(0, 300);
  return clean;
}
export function validateCheckout(f: CheckoutFields): CheckoutErrors {
  const e: CheckoutErrors = {};
  if (f.name.trim().length < 2) e.name = 'Укажите имя — хотя бы два символа.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()))
    e.email = 'Проверьте email, например asya@example.com.';
  if (!/^\d{10,15}$/.test(f.phone.replace(/[\s()+-]/g, '')))
    e.phone = 'Укажите телефон: от 10 до 15 цифр, без букв.';
  if (f.city.trim().length < 2) e.city = 'Укажите название города.';
  const address = f.delivery === 'pickup' ? 'pickupAddress' : 'courierAddress';
  if (f[address].trim().length < 5)
    e[address] =
      f.delivery === 'pickup'
        ? 'Укажите адрес пункта выдачи.'
        : 'Укажите улицу, дом и квартиру.';
  for (const key of Object.keys(fieldLimits) as (keyof typeof fieldLimits)[])
    if (f[key].length > fieldLimits[key]) e[key] = 'Слишком длинное значение.';
  if (!deliveryOptions.some((o) => o.id === f.delivery))
    e.delivery = 'Выберите способ доставки.';
  if (!f.consent) e.consent = 'Подтвердите согласие.';
  if (!f.demo) e.demo = 'Подтвердите, что это демонстрация.';
  return e;
}
export function checkoutTotal(
  items: CartLine[],
  delivery: string,
  catalog: Product[] = products
) {
  const option = deliveryOptions.find((o) => o.id === delivery);
  if (!option) throw new Error('Unknown delivery method');
  return cartSubtotal(items, catalog) + option.price * 100;
}
