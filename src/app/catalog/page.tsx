import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Catalog } from '@/components/catalog';
export const metadata: Metadata = {
  title: 'Каталог',
  description:
    'Маленькие сокровища: авторские открытки, закладки, блокноты ручного переплёта, украшения и подарочные наборы.',
};
export default function CatalogPage() {
  return (
    <div className="container page-space">
      <div className="page-heading catalog-heading">
        <div>
          <p className="eyebrow">Вещи с историей</p>
          <h1>Полки мастерской</h1>
        </div>
        <p>
          Для записей, любимых книг
          <br />и людей, которым хочется подарить чудо.
        </p>
      </div>
      <Suspense
        fallback={<p className="loading-note">Раскладываем вещи на полках…</p>}
      >
        <Catalog />
      </Suspense>
    </div>
  );
}
