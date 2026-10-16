import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreLots, resizeLots, consumeLots } from './cart-lots';
test('Payment consumes original additions and preserves later additions of the same product', () => {
  const initial = restoreLots([{ id: 'ps-001', variant: '', quantity: 2 }]);
  const snapshot = structuredClone(initial);
  const later = resizeLots(initial, [
    { id: 'ps-001', variant: '', quantity: 4 },
  ]);
  const result = consumeLots(later, snapshot);
  assert.equal(result[0].quantity, 2);
  assert.notEqual(result[0].lots[0].key, snapshot[0].lots[0].key);
  assert.deepEqual(consumeLots(result, snapshot), result);
});
test('Removing and adding again does not let an old order consume new cart items', () => {
  const initial = restoreLots([{ id: 'ps-001', variant: '', quantity: 1 }]);
  const empty = resizeLots(initial, []);
  const later = resizeLots(empty, [{ id: 'ps-001', variant: '', quantity: 2 }]);
  assert.deepEqual(consumeLots(later, initial), later);
});
test('Decrease removes the newest quantities; unrelated products and variants survive payment', () => {
  const initial = restoreLots([
    { id: 'ps-008', variant: 'В точку', quantity: 1 },
  ]);
  const later = resizeLots(initial, [
    { id: 'ps-008', variant: 'В точку', quantity: 3 },
    { id: 'ps-008', variant: 'Чистые страницы', quantity: 1 },
  ]);
  const smaller = resizeLots(later, [
    { id: 'ps-008', variant: 'В точку', quantity: 2 },
    { id: 'ps-008', variant: 'Чистые страницы', quantity: 1 },
  ]);
  const result = consumeLots(smaller, initial);
  assert.equal(result.length, 2);
  assert.equal(
    result.reduce((s, l) => s + l.quantity, 0),
    2
  );
});
test('Lot identities persist across reload and malformed quantities are normalized', () => {
  const a = restoreLots([{ id: 'ps-001', variant: '', quantity: 2 }]);
  assert.deepEqual(restoreLots(JSON.parse(JSON.stringify(a))), a);
  assert.deepEqual(
    restoreLots([{ id: 'unknown', variant: '', quantity: 3 }]),
    []
  );
});
