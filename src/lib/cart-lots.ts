import { products, type Product } from '../data/catalog';
import { normalizeCart, type CartLine } from './cart';
import type { CartLot, OrderRequestLine } from './order-types';
export type LotLine = CartLine & { lots: CartLot[] };
const fresh = (quantity: number): CartLot => ({
  key: crypto.randomUUID(),
  quantity,
});
export function restoreLots(
  value: unknown,
  catalog: Product[] = products
): LotLine[] {
  const normalized = normalizeCart(value, catalog);
  const seen = new Set<string>();
  return normalized.map((line) => {
    const source = Array.isArray(value)
      ? value.filter((v) => v && v.id === line.id && v.variant === line.variant)
      : [];
    let remaining = line.quantity;
    const lots: CartLot[] = [];
    for (const raw of source.flatMap((v) =>
      Array.isArray(v.lots) ? v.lots : []
    )) {
      if (remaining <= 0) break;
      if (
        typeof raw?.key !== 'string' ||
        !/^[a-zA-Z0-9_-]{20,80}$/.test(raw.key) ||
        seen.has(raw.key) ||
        !Number.isSafeInteger(raw.quantity) ||
        raw.quantity < 1
      )
        continue;
      const quantity = Math.min(remaining, raw.quantity);
      seen.add(raw.key);
      lots.push({ key: raw.key, quantity });
      remaining -= quantity;
    }
    if (remaining > 0) lots.push(fresh(remaining));
    return { ...line, lots };
  });
}
export function resizeLots(before: LotLine[], after: CartLine[]): LotLine[] {
  return after.map((line) => {
    const old = before.find(
      (l) => l.id === line.id && l.variant === line.variant
    );
    const lots = old ? old.lots.map((l) => ({ ...l })) : [];
    let delta = line.quantity - (old?.quantity || 0);
    if (delta > 0) lots.push(fresh(delta));
    while (delta < 0 && lots.length) {
      const last = lots[lots.length - 1];
      const remove = Math.min(last.quantity, -delta);
      last.quantity -= remove;
      delta += remove;
      if (!last.quantity) lots.pop();
    }
    return { ...line, lots };
  });
}
// A paid order consumes the exact additions captured when it was created.
// Later additions get new lot keys, so repeat visits cannot remove them.
export function consumeLots(
  cart: LotLine[],
  purchased: OrderRequestLine[]
): LotLine[] {
  const consume = new Map(
    purchased.flatMap((i) => i.lots.map((l) => [l.key, l.quantity] as const))
  );
  return cart
    .map((line) => {
      const lots = line.lots
        .map((l) => ({
          ...l,
          quantity: Math.max(0, l.quantity - (consume.get(l.key) || 0)),
        }))
        .filter((l) => l.quantity > 0);
      return {
        ...line,
        lots,
        quantity: lots.reduce((s, l) => s + l.quantity, 0),
      };
    })
    .filter((l) => l.quantity > 0);
}
