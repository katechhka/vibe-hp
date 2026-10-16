'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { addToCart, updateCart, type CartLine } from '@/lib/cart';
import {
  restoreLots,
  resizeLots,
  consumeLots,
  type LotLine,
} from '@/lib/cart-lots';
import { useCatalog } from './catalog-context';
import type { OrderRequestLine } from '@/lib/order-types';
export type { CartLine } from '@/lib/cart';
const storageKey = 'ps-cart-v1';
type Shop = {
  items: CartLine[];
  getStock: (id: string) => number;
  ready: boolean;
  add: (id: string, variant: string, quantity: number) => boolean;
  update: (id: string, variant: string, quantity: number) => void;
  count: number;
  storageWarning: string;
  snapshot: () => OrderRequestLine[];
  consume: (lines: OrderRequestLine[]) => void;
};
const Context = createContext<Shop | null>(null);
export function ShopProvider({ children }: { children: ReactNode }) {
  const products = useCatalog();
  const restoreCatalog = products.map((p) => ({ ...p, stock: 100000 }));
  const restore = (value: unknown) =>
    restoreLots(
      value,
      Array.isArray(value) &&
        value.some((l) => Array.isArray(l?.lots) && l.lots.length)
        ? restoreCatalog
        : products
    );
  const [items, setItems] = useState<LotLine[]>([]),
    current = useRef<LotLine[]>([]);
  const storageBlocked = useRef(false);
  const [stocks, setStocks] = useState<Record<string, number>>({});
  const getStock = (id: string) =>
    products.some((p) => p.id === id)
      ? (stocks[id] ?? products.find((p) => p.id === id)?.stock ?? 0)
      : 0;
  const refreshStock = async () => {
    try {
      const response = await fetch('/api/stock', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        setStocks(data.stock);
      }
    } catch {}
  };
  const [ready, setReady] = useState(false),
    [storageWarning, setStorageWarning] = useState('');
  const persist = (next: LotLine[]) => {
    current.current = next;
    setItems(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      storageBlocked.current = false;
      setStorageWarning('');
    } catch {
      storageBlocked.current = true;
      setStorageWarning(
        'Браузер не разрешает сохранить корзину. Она доступна сейчас, но может исчезнуть после обновления страницы.'
      );
    }
  };
  useEffect(() => {
    let next: LotLine[] = [];
    try {
      next = restore(JSON.parse(localStorage.getItem(storageKey) || '[]'));
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setStorageWarning(
        'Не удалось прочитать или сохранить корзину. Она доступна в этой вкладке; обновление страницы может потерять изменения.'
      );
    }
    current.current = next;
    setItems(next);
    setReady(true);
    const sync = (event: StorageEvent) => {
      if (
        event.storageArea !== localStorage ||
        (event.key !== storageKey && event.key !== null)
      )
        return;
      try {
        const next = restore(JSON.parse(event.newValue || '[]'));
        current.current = next;
        setItems(next);
      } catch {
        setStorageWarning(
          'Не удалось обновить корзину из другой вкладки. Обновите страницу.'
        );
      }
    };
    window.addEventListener('storage', sync);
    void refreshStock();
    const focus = () => {
      void refreshStock();
    };
    window.addEventListener('focus', focus);
    const timer = setInterval(focus, 30000);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', focus);
      clearInterval(timer);
    };
  }, [products]);
  const latest = () => {
    if (storageBlocked.current) return current.current;
    // Read before mutation so a payment result also sees additions from other tabs.
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return restore(JSON.parse(raw));
    } catch {}
    return current.current;
  };
  const add = (id: string, variant: string, quantity: number) => {
    if (!ready) return false;
    const before = latest(),
      after = addToCart(before, id, variant, quantity, products);
    if (
      !after ||
      after.filter((l) => l.id === id).reduce((s, l) => s + l.quantity, 0) >
        getStock(id)
    )
      return false;
    persist(resizeLots(before, after));
    return true;
  };
  const update = (id: string, variant: string, quantity: number) => {
    if (!ready) return;
    const before = latest();
    persist(
      resizeLots(before, updateCart(before, id, variant, quantity, products))
    );
  };
  const snapshot = () =>
    current.current.map((l) => ({ ...l, lots: l.lots.map((x) => ({ ...x })) }));
  const consume = (lines: OrderRequestLine[]) => {
    if (ready) {
      persist(consumeLots(latest(), lines));
      void refreshStock();
    }
  };
  return (
    <Context.Provider
      value={{
        items,
        getStock,
        ready,
        add,
        update,
        count: items.reduce((s, l) => s + l.quantity, 0),
        storageWarning,
        snapshot,
        consume,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useShop() {
  const shop = useContext(Context);
  if (!shop) throw new Error('ShopProvider is required');
  return shop;
}
