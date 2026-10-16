'use client';
import { useRef, useState, useEffect } from 'react';
import { featuredProducts as initialFeatured, type Product } from '@/data/catalog';
import { useCatalog } from './catalog-context';
import { ProductCard } from './product-card';
import { Icon } from './icons';
import Link from 'next/link';
export function Carousel() {
  const catalog = useCatalog();
  const featuredProducts = [...initialFeatured.map(f=>catalog.find(p=>p.id===f.id)).filter((p):p is Product=>!!p),...catalog.filter(p=>!initialFeatured.some(f=>f.id===p.id))].slice(0,8);
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const move = (direction: number) => {
    const el = ref.current;
    if (!el) return;
    const card = el.querySelector<HTMLElement>('.product-card');
    el.scrollBy({
      left:
        direction *
        ((card?.offsetWidth || 300) +
          Number.parseFloat(getComputedStyle(el).gap || '0')),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  };
  const update = () => {
    const e = ref.current;
    if (e)
      setEdges({
        start: e.scrollLeft < 5,
        end: e.scrollLeft + e.clientWidth >= e.scrollWidth - 5,
      });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    update();
    return () => observer.disconnect();
  }, []);
  return (
    <section className="favorites container" aria-labelledby="favorites-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Полка любимых вещей</p>
          <h2 id="favorites-title">Маленькие сокровища</h2>
        </div>
        <div className="section-controls">
          <Link className="text-link" href="/catalog">
            Весь каталог <Icon name="arrow" size={19} />
          </Link>
          <div className="carousel-buttons">
            <button
              className="icon-button outlined"
              disabled={edges.start}
              aria-label="Предыдущие товары"
              onClick={() => move(-1)}
            >
              <Icon name="left" />
            </button>
            <button
              className="icon-button outlined"
              disabled={edges.end}
              aria-label="Следующие товары"
              onClick={() => move(1)}
            >
              <Icon name="arrow" />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={ref}
        className="product-carousel"
        onScroll={update}
        tabIndex={0}
        role="region"
        aria-label="Избранные товары; используйте стрелки для прокрутки"
        onKeyDown={(e) => {
          if (
            e.target === e.currentTarget &&
            ['ArrowLeft', 'ArrowRight'].includes(e.key)
          ) {
            e.preventDefault();
            move(e.key === 'ArrowLeft' ? -1 : 1);
          }
        }}
      >
        {featuredProducts.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
      <p className="carousel-caption">
        <span>Сделано небольшими сериями</span>
        <span>
          Листайте и находите своё <span aria-hidden="true">→</span>
        </span>
      </p>
    </section>
  );
}
