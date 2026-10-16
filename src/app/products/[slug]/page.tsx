import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { appStore as getStore } from '@/server/app-store';
import { imageSrc } from '@/lib/product-image';
import { ProductDetail } from '@/components/product-detail';
import { ProductCard } from '@/components/product-card';
export const dynamic = 'force-dynamic';
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = (await getStore().catalog()).find((p) => p.slug === slug);
  return p
    ? {
        title: p.name,
        description: p.short,
        openGraph: { images: [{ url: imageSrc(p.image), alt: p.alt }] },
      }
    : { title: 'Вещь не найдена' };
}
export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const products = await getStore().catalog(),
    { slug } = await params,
    p = products.find((p) => p.slug === slug);
  if (!p) notFound();
  const related = products
    .filter((i) => i.id !== p.id && i.stock > 0)
    .sort(
      (a, b) =>
        Number(b.categorySlug === p.categorySlug) -
        Number(a.categorySlug === p.categorySlug)
    )
    .slice(0, 3);
  return (
    <div className="container product-page">
      <nav className="breadcrumbs" aria-label="Хлебные крошки">
        <Link href="/">Главная</Link>
        <span>/</span>
        <Link href="/catalog">Каталог</Link>
        <span>/</span>
        <span aria-current="page">{p.name}</span>
      </nav>
      <ProductDetail product={p} />
      <section className="related-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Хорошая компания</p>
            <h2>Рядом на полке</h2>
          </div>
          <Link className="text-link" href="/catalog">
            Все вещи <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="related-grid">
          {related.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>
    </div>
  );
}
