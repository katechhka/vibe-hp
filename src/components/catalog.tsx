'use client';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { categories } from '@/data/catalog';
import { ProductCard } from './product-card';
import { useCatalog } from './catalog-context';
import { Icon } from './icons';
export function Catalog() {
  const products = useCatalog();
  const params = useSearchParams();
  const query = params.get('q') || '';
  const category = categories.some((c) => c.slug === params.get('category'))
    ? params.get('category')!
    : '';
  const sort = ['price-asc', 'price-desc'].includes(params.get('sort') || '')
    ? params.get('sort')!
    : '';
  const change = (key: string, value: string, replace = false) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    const suffix = next.toString();
    window.history[replace ? 'replaceState' : 'pushState'](
      null,
      '',
      '/catalog' + (suffix ? '?' + suffix : '')
    );
  };
  const setQuery = (value: string) => change('q', value.slice(0, 100), true);
  const setCategory = (value: string) => change('category', value);
  const setSort = (value: string) => change('sort', value);
  const found = useMemo(() => {
    const list = products.filter(
      (p) =>
        (!category || p.categorySlug === category) &&
        (p.name + ' ' + p.short + ' ' + p.category)
          .toLocaleLowerCase('ru')
          .includes(query.trim().toLocaleLowerCase('ru'))
    );
    return sort === 'price-asc'
      ? list.sort((a, b) => a.price - b.price)
      : sort === 'price-desc'
        ? list.sort((a, b) => b.price - a.price)
        : list;
  }, [query, category, sort, products]);
  const reset = () => window.history.pushState(null, '', '/catalog');
  return (
    <>
      <div className="catalog-toolbar">
        <div className="search-field">
          <Icon name="search" size={20} />
          <label className="sr-only" htmlFor="catalog-search">
            Найти вещь
          </label>
          <input
            id="catalog-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти что-то особенное"
            type="search"
            maxLength={100}
          />
          {query && (
            <button
              className="icon-button"
              aria-label="Очистить поиск"
              onClick={() => setQuery('')}
            >
              <Icon name="close" size={17} />
            </button>
          )}
        </div>
        <label className="sort-field">
          Порядок на полке
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="">Выбор мастерской</option>
            <option value="price-asc">Сначала дешевле</option>
            <option value="price-desc">Сначала дороже</option>
          </select>
        </label>
      </div>
      <div className="category-tabs" role="group" aria-label="Категории">
        <button aria-pressed={!category} onClick={() => setCategory('')}>
          Все вещи <span>12</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.slug}
            aria-pressed={category === c.slug}
            onClick={() => setCategory(c.slug)}
          >
            {c.name}
          </button>
        ))}
      </div>
      <div className="results-caption">
        <span role="status" aria-live="polite">
          {found.length}{' '}
          {found.length === 1
            ? 'вещь'
            : found.length >= 2 && found.length <= 4
              ? 'вещи'
              : 'вещей'}{' '}
          в мастерской
        </span>
        {(query || category || sort) && (
          <button className="plain-button" onClick={reset}>
            Сбросить фильтры <span aria-hidden="true">×</span>
          </button>
        )}
        <span>Ручная работа · бережная упаковка</span>
      </div>
      {found.length ? (
        <div className="catalog-grid">
          {found.map((product, i) => (
            <ProductCard key={product.id} product={product} priority={i < 3} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="search" size={38} />
          <h2>На этой полке пока пусто</h2>
          <p>Попробуйте другое название или откройте все вещи мастерской.</p>
          <button className="button" onClick={reset}>
            Показать все вещи
            <Icon name="arrow" size={20} />
          </button>
        </div>
      )}
      <div className="catalog-footnote">
        <Icon name="star" size={25} />
        <p>
          Каждая вещь проходит через мои руки.
          <br />
          Спасибо, что выбираете маленькие мастерские.
        </p>
        <span className="signature">Ася</span>
      </div>
    </>
  );
}
