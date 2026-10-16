import test from 'node:test';
import assert from 'node:assert/strict';
import { products } from '../data/catalog';
import { normalizeCart, addToCart, updateCart, cartSubtotal } from './cart';
const notebook = products.find((p) => p.slug === 'night-library')!;
const variants = notebook.variants!;
test('restored cart merges duplicate lines and caps shared stock across variants', () => {
  const input = [
    null,
    {},
    { id: notebook.id, variant: variants[0], quantity: 3 },
    { id: notebook.id, variant: variants[0], quantity: 1 },
    { id: notebook.id, variant: variants[1], quantity: 99 },
  ];
  const result = normalizeCart(input);
  assert.deepEqual(result, [
    { id: notebook.id, variant: variants[0], quantity: 4 },
    { id: notebook.id, variant: variants[1], quantity: 1 },
  ]);
  assert.equal(input[2]?.quantity, 3);
});
test('malformed, unavailable, unknown and invalid variant lines are discarded', () => {
  const unavailable = products.find((p) => p.stock === 0)!;
  assert.deepEqual(
    normalizeCart([
      null,
      'x',
      { id: 'missing', variant: '', quantity: 1 },
      { id: notebook.id, variant: 'forged', quantity: 1 },
      { id: notebook.id, variant: variants[0], quantity: 1.5 },
      { id: notebook.id, variant: variants[0], quantity: -1 },
      { id: unavailable.id, variant: '', quantity: 1 },
    ]),
    []
  );
  assert.deepEqual(normalizeCart({}), []);
});
test('sequential repeated adds cannot oversell the stock', () => {
  let cart = normalizeCart([]);
  for (let i = 0; i < 20; i++)
    cart = addToCart(cart, notebook.id, variants[i % 2], 1) || cart;
  assert.equal(
    cart.reduce((s, i) => s + i.quantity, 0),
    notebook.stock
  );
  assert.equal(addToCart(cart, notebook.id, variants[0], 1), null);
});
test('invalid adds and fractional quantities are rejected', () => {
  assert.equal(addToCart([], notebook.id, variants[0], -1), null);
  assert.equal(addToCart([], notebook.id, variants[0], 1.3), null);
  assert.equal(addToCart([], notebook.id, 'not-a-variant', 1), null);
});
test('quantity updates respect other variants and zero removes a line', () => {
  const cart = [
    { id: notebook.id, variant: variants[0], quantity: 2 },
    { id: notebook.id, variant: variants[1], quantity: 2 },
  ];
  assert.equal(updateCart(cart, notebook.id, variants[0], 100)[0].quantity, 3);
  assert.deepEqual(updateCart(cart, notebook.id, variants[0], 0), [cart[1]]);
  assert.deepEqual(updateCart(cart, notebook.id, variants[0], -1), cart);
});
test('subtotal is calculated in integer kopecks from catalogue prices', () => {
  const letter = products.find((p) => p.slug === 'letter')!;
  assert.equal(
    cartSubtotal([
      { id: notebook.id, variant: variants[0], quantity: 2 },
      { id: letter.id, variant: '', quantity: 3 },
    ]),
    425000
  );
});
