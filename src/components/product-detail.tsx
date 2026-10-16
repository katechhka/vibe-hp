'use client';
import { useState, useRef } from 'react';
import Image from 'next/image';
import { imageSrc } from '@/lib/product-image';
import Link from 'next/link';
import { type Product, money } from '@/data/catalog';
import { Icon } from './icons';
import { useCatalog } from './catalog-context';
import { useShop } from './shop-context';
export function ProductDetail({
  product: initialProduct,
}: {
  product: Product;
}) {
  const p =
    useCatalog().find((p) => p.id === initialProduct.id) || initialProduct;
  const [index, setIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [variant, setVariant] = useState(p.variants?.[0] || '');
  const selectedVariant = p.variants?.includes(variant)
    ? variant
    : p.variants?.[0] || '';
  const [notice, setNotice] = useState('');
  const touch = useRef({ x: 0, y: 0 });
  const { add, items, ready, storageWarning, getStock } = useShop();
  const stock = getStock(p.id);
  const remaining =
    stock -
    items.filter((i) => i.id === p.id).reduce((s, i) => s + i.quantity, 0);
  const selectedQuantity = Math.min(quantity, Math.max(1, remaining));
  const sources = p.gallery || [
    imageSrc(p.image),
    '/images/' + p.image + '-detail.webp',
  ];
  const currentIndex = Math.min(index, sources.length - 1);
  return (
    <div className="product-layout">
      <div className="gallery">
        <div
          className="gallery-main"
          role="region"
          aria-label="Галерея товара"
          tabIndex={0}
          onKeyDown={(e) => {
            if (
              e.target === e.currentTarget &&
              ['ArrowLeft', 'ArrowRight'].includes(e.key)
            ) {
              e.preventDefault();
              setIndex(
                (i) =>
                  (i + (e.key === 'ArrowLeft' ? sources.length - 1 : 1)) %
                  sources.length
              );
            }
          }}
          onTouchStart={(e) => {
            touch.current = {
              x: e.touches[0].clientX,
              y: e.touches[0].clientY,
            };
          }}
          onTouchEnd={(e) => {
            const dx = e.changedTouches[0].clientX - touch.current.x;
            const dy = e.changedTouches[0].clientY - touch.current.y;
            if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy))
              setIndex((i) => (i + 1) % sources.length);
          }}
        >
          <Image
            src={sources[currentIndex]}
            alt={p.alt + (index ? ' — крупный план детали' : '')}
            width={1000}
            height={1250}
            priority
            sizes="(max-width: 800px) 100vw, 55vw"
          />
          <span className="gallery-counter" role="status" aria-live="polite">
            {String(currentIndex + 1).padStart(2, '0')} /{' '}
            {String(sources.length).padStart(2, '0')}
          </span>
          <div className="gallery-arrows">
            <button
              className="icon-button"
              disabled={sources.length < 2}
              onClick={() =>
                setIndex((i) => (i + sources.length - 1) % sources.length)
              }
              aria-label="Предыдущее изображение"
            >
              <Icon name="left" />
            </button>
            <button
              className="icon-button"
              onClick={() => setIndex((i) => (i + 1) % sources.length)}
              aria-label="Следующее изображение"
            >
              <Icon name="arrow" />
            </button>
          </div>
        </div>
        <div className="gallery-thumbs" aria-label="Изображения товара">
          {sources.map((src, i) => (
            <button
              key={src}
              onClick={() => setIndex(i)}
              aria-label={i ? 'Деталь ' + i : 'Общий вид'}
              aria-pressed={currentIndex === i}
            >
              <Image src={src} alt="" width={80} height={100} />
              <span>{i ? 'Деталь' : 'Общий вид'}</span>
            </button>
          ))}
        </div>
        <p className="image-note">
          Каждая вещь сделана вручную. Небольшие отличия — часть её характера.
        </p>
      </div>
      <div className="product-info">
        <p className="eyebrow">{p.category}</p>
        <h1>{p.name}</h1>
        <p className="product-intro">{p.short}</p>
        <p className="product-price">{money(p.price)}</p>
        <p className={'availability' + (!stock ? ' unavailable' : '')}>
          <span />
          {stock ? p.leadTime || 'В наличии' : 'Нет в наличии - срок ожидания увеличен'}
        </p>
        {p.variants && (
          <fieldset className="variant-field">
            <legend>Вариант исполнения</legend>
            <div className="variant-buttons">
              {p.variants.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVariant(v)}
                  aria-pressed={selectedVariant === v}
                >
                  {v}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <div className="purchase-row">
          <div className="quantity-control">
            <button
              aria-label="Уменьшить количество"
              disabled={selectedQuantity <= 1 || !stock}
              onClick={() => setQuantity(selectedQuantity - 1)}
            >
              <Icon name="minus" size={16} />
            </button>
            <output aria-label="Количество">{selectedQuantity}</output>
            <button
              aria-label="Увеличить количество"
              disabled={selectedQuantity >= remaining || !stock}
              onClick={() => setQuantity(selectedQuantity + 1)}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          <button
            className="button"
            disabled={!ready || !stock || remaining <= 0}
            onClick={() => {
              const ok = add(p.id, selectedVariant, selectedQuantity);
              setNotice(
                ok
                  ? 'Вещь уже в вашей корзине.'
                  : 'Не удалось добавить это количество. Проверьте доступный остаток.'
              );
            }}
          >
            {stock
              ? remaining > 0
                ? 'Добавить в корзину'
                : 'Всё уже в корзине'
              : 'Сейчас нет в наличии'}
            <Icon name="bag" size={19} />
          </button>
        </div>
        <div className="add-notice" role="status">
          {notice && (
            <>
              <Icon name="check" size={18} />
              <span>
                {notice} <Link href="/cart">Открыть корзину →</Link>
              </span>
            </>
          )}
        </div>
        {storageWarning && (
          <p role="status" className="stage-note">
            {storageWarning}
          </p>
        )}
        <p className="shipping-note">
          Бережная упаковка уже включена.
          <br />
          <Link href="/delivery">
            Доставка по России от 350 ₽ <span aria-hidden="true">↗</span>
          </Link>
        </p>
        {p.description && (
          <div className="product-description">
            <h2>Об этой вещи</h2>
            <p>{p.description}</p>
          </div>
        )}
        <div className="details-list">
          {[
            ['Материалы', p.materials],
            ['Размер', p.size],
            ['Уход', p.care],
          ]
            .filter(([, value]) => !!value)
            .map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <p>{value}</p>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
