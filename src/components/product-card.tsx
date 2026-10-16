'use client';
import Link from 'next/link';
import { useShop } from './shop-context';
import Image from 'next/image';
import { imageSrc } from '@/lib/product-image';
import { money, type Product } from '@/data/catalog';
export function ProductCard({
  product,
  priority = false,
}: {
  product: Product;
  priority?: boolean;
}) {
  const stock = useShop().getStock(product.id);
  return (
    <Link className="product-card" href={'/products/' + product.slug}>
      <div className="product-card__image">
        <Image
          src={imageSrc(product.image)}
          alt={product.alt}
          width={800}
          height={1000}
          priority={priority}
          sizes="(max-width: 600px) 90vw, (max-width: 1000px) 45vw, 30vw"
        />
        {product.tag && <span className="product-tag">{product.tag}</span>}
        {!stock && <span className="product-tag">Скоро вернётся</span>}
        <span className="card-open" aria-hidden="true">
          ↗
        </span>
      </div>
      <div className="card-meta">
        <span>{product.category}</span>
        <span>{money(product.price)}</span>
      </div>
      <h3>{product.name}</h3>
      <p className="card-note">
        {stock ? 'В наличии' : 'Нет в наличии - срок ожидания увеличен'}
      </p>
    </Link>
  );
}
