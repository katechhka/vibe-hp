import test from 'node:test';
import assert from 'node:assert/strict';
import { products } from '../data/catalog';
import {
  initialCheckout,
  validateCheckout,
  restoreDraft,
  checkoutTotal,
  type CheckoutFields,
} from './checkout';
const valid: CheckoutFields = {
  ...initialCheckout,
  name: 'Ася',
  email: 'asya@example.com',
  phone: '+7 (999) 123-45-67',
  city: 'Москва',
  pickupAddress: 'Тестовая улица, 12',
  consent: true,
  demo: true,
};
test('valid checkout has no errors and surrounding email whitespace is tolerated', () => {
  assert.deepEqual(validateCheckout(valid), {});
  assert.deepEqual(
    validateCheckout({ ...valid, email: ' asya@example.com ' }),
    {}
  );
});
test('missing contact details, address and consents are all reported', () => {
  const errors = validateCheckout(initialCheckout);
  for (const key of [
    'name',
    'email',
    'phone',
    'city',
    'pickupAddress',
    'consent',
    'demo',
  ])
    assert.ok(errors[key as keyof typeof errors]);
});
test('phone rejects letters and implausible lengths instead of stripping invalid content', () => {
  for (const phone of [
    'abc79991234567',
    '123',
    '1234567890123456',
    '79991234567.',
  ])
    assert.ok(validateCheckout({ ...valid, phone }).phone);
});
test('courier checkout requires its own address and ignores inactive pickup address', () => {
  assert.ok(validateCheckout({ ...valid, delivery: 'courier' }).courierAddress);
  assert.deepEqual(
    validateCheckout({
      ...valid,
      delivery: 'courier',
      pickupAddress: '',
      courierAddress: 'Тестовая улица, 8, кв. 1',
    }),
    {}
  );
});
test('oversized comments and unknown delivery are rejected', () => {
  assert.ok(validateCheckout({ ...valid, comment: 'x'.repeat(1001) }).comment);
  assert.ok(
    validateCheckout({ ...valid, delivery: 'forged' as 'pickup' }).delivery
  );
});
test('restored draft validates types, limits lengths and never restores consent', () => {
  assert.equal(restoreDraft(null).name, '');
  const restored = restoreDraft({
    name: 123,
    phone: '9'.repeat(99),
    delivery: 'forged',
    demo: true,
    consent: true,
    pickupAddress: 'Тестовый пункт, 4',
  });
  assert.equal(restored.name, '');
  assert.equal(restored.phone.length, 30);
  assert.equal(restored.delivery, 'pickup');
  assert.equal(restored.demo, false);
  assert.equal(restored.consent, false);
});
test('old draft address migrates only into its original delivery method', () => {
  const restored = restoreDraft({
    delivery: 'courier',
    address: 'Тестовая улица, 1',
  });
  assert.equal(restored.courierAddress, 'Тестовая улица, 1');
  assert.equal(restored.pickupAddress, '');
});
test('both delivery tariffs use one source and totals are in kopecks', () => {
  const p = products.find((p) => p.slug === 'night-library')!;
  const lines = [{ id: p.id, variant: p.variants![0], quantity: 1 }];
  assert.equal(checkoutTotal(lines, 'pickup'), 204000);
  assert.equal(checkoutTotal(lines, 'courier'), 234000);
  assert.throws(() => checkoutTotal(lines, 'forged'));
});
