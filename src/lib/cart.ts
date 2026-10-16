import { products, type Product } from '../data/catalog';
export type CartLine = { id: string; variant: string; quantity: number };
const find = (id: string, catalog: Product[]) =>
  catalog.find((p) => p.id === id);
export function validVariant(
  id: string,
  variant: string,
  catalog: Product[] = products
) {
  const p = find(id, catalog);
  return !!p && (p.variants ? p.variants.includes(variant) : variant === '');
}
export function normalizeCart(
  value: unknown,
  catalog: Product[] = products
): CartLine[] {
  if (!Array.isArray(value)) return [];
  const result: CartLine[] = [];
  for (const entry of value.slice(0, 100)) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, variant, quantity } = entry;
    if (
      typeof id !== 'string' ||
      typeof variant !== 'string' ||
      !Number.isSafeInteger(quantity) ||
      quantity <= 0 ||
      !validVariant(id, variant, catalog)
    )
      continue;
    const p = find(id, catalog)!;
    const used = result
      .filter((i) => i.id === id)
      .reduce((s, i) => s + i.quantity, 0);
    const available = Math.min(quantity, p.stock - used);
    if (available <= 0) continue;
    const existing = result.find((i) => i.id === id && i.variant === variant);
    if (existing) existing.quantity += available;
    else result.push({ id, variant, quantity: available });
  }
  return result;
}
export function addToCart(
  items: CartLine[],
  id: string,
  variant: string,
  quantity: number,
  catalog: Product[] = products
): CartLine[] | null {
  const p = find(id, catalog);
  if (
    !p ||
    !validVariant(id, variant, catalog) ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0
  )
    return null;
  const used = items
    .filter((i) => i.id === id)
    .reduce((s, i) => s + i.quantity, 0);
  if (used + quantity > p.stock) return null;
  return items.some((i) => i.id === id && i.variant === variant)
    ? items.map((i) =>
        i.id === id && i.variant === variant
          ? { ...i, quantity: i.quantity + quantity }
          : i
      )
    : [...items, { id, variant, quantity }];
}
export function updateCart(
  items: CartLine[],
  id: string,
  variant: string,
  quantity: number,
  catalog: Product[] = products
) {
  const p = find(id, catalog);
  if (!p || !Number.isSafeInteger(quantity) || quantity < 0) return items;
  const other = items
    .filter((i) => i.id === id && i.variant !== variant)
    .reduce((s, i) => s + i.quantity, 0);
  const safe = Math.min(quantity, Math.max(0, p.stock - other));
  return items
    .map((i) =>
      i.id === id && i.variant === variant ? { ...i, quantity: safe } : i
    )
    .filter((i) => i.quantity > 0);
}
export function cartSubtotal(items: CartLine[], catalog: Product[] = products) {
  return normalizeCart(
    items,
    catalog.map((p) => ({ ...p, stock: 100000 }))
  ).reduce(
    (s, i) => s + Math.round(find(i.id, catalog)!.price * 100) * i.quantity,
    0
  );
}
