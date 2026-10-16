'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Product } from '@/data/catalog';
const Context = createContext<Product[]>([]);
export function CatalogProvider({
  products,
  children,
}: {
  products: Product[];
  children: ReactNode;
}) {
  const [current, setCurrent] = useState(products);
  useEffect(() => setCurrent(products), [products]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const r = await fetch('/api/catalog', { cache: 'no-store' });
        if (r.ok && active) {
          const d = await r.json();
          setCurrent((previous) =>
            JSON.stringify(previous) === JSON.stringify(d.products)
              ? previous
              : d.products
          );
        }
      } catch {}
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return <Context.Provider value={current}>{children}</Context.Provider>;
}
export const useCatalog = () => useContext(Context);
