import { productSlug } from '../lib/product-slug';
import type Database from 'better-sqlite3';
import { products as seed, categories, type Product } from '../data/catalog';
import { randomUUID } from 'node:crypto';
import { ShopError, type ShopStore } from './store';
export function migrateCatalog(db: Database.Database) {
  db.exec(
    'CREATE TABLE IF NOT EXISTS catalog(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,data TEXT NOT NULL,visible INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 1); INSERT OR IGNORE INTO schema_versions VALUES(4);'
  );
  db.exec(
    'CREATE TABLE IF NOT EXISTS inventory_versions(id TEXT PRIMARY KEY REFERENCES inventory(id),version INTEGER NOT NULL DEFAULT 1); INSERT OR IGNORE INTO inventory_versions(id) SELECT id FROM inventory;'
  );
  const insert = db.prepare(
    'INSERT OR IGNORE INTO catalog(id,slug,data) VALUES(?,?,?)'
  );
  for (const p of seed)
    insert.run(
      p.id,
      p.slug,
      JSON.stringify({
        ...p,
        gallery: [
          '/images/' + p.image + '.webp',
          '/images/' + p.image + '-detail.webp',
        ],
      })
    );
}
export function catalog(db: Database.Database, admin = false): Product[] {
  return (
    db
      .prepare(
        'SELECT c.data,c.visible,c.revision,i.remaining FROM catalog c JOIN inventory i ON i.id=c.id ' +
          (admin ? '' : 'WHERE c.visible=1') +
          ' ORDER BY c.rowid'
      )
      .all() as {
      data: string;
      visible: number;
      revision: number;
      remaining: number;
    }[]
  ).map((r) => ({
    ...JSON.parse(r.data),
    stock: r.remaining,
    visible: !!r.visible,
    revision: r.revision,
  }));
}
export function adminProducts(store: ShopStore) {
  const available = store.stock();
  return catalog(store.native, true).map((p) => ({
    ...p,
    reserved: p.stock - (available[p.id] ?? 0),
    available: available[p.id] ?? 0,
    stockRevision: (
      store.native
        .prepare('SELECT version FROM inventory_versions WHERE id=?')
        .get(p.id) as { version: number }
    ).version,
  }));
}
export function validateProduct(input: unknown, allProducts: Product[]) {
  const raw = input as Record<string, unknown>;
  const v = {
    stock: 0,
    gallery: [],
    variants: [],
    visible: false,
    categorySlug: categories[0].slug,
    ...raw,
  } as Record<string, unknown>;
  if (!v || typeof v !== 'object')
    throw new ShopError(400, 'Проверьте поля товара.');
  const existing =
    typeof v.id === 'string'
      ? allProducts.find((p) => p.id === v.id)
      : undefined;
  if (v.id && !existing) throw new ShopError(404, 'Товар не найден.');
  const labels: Record<string, string> = {
    slug: 'Адрес страницы',
    name: 'Название',
    leadTime: 'Срок изготовления',
    short: 'Краткое описание',
    description: 'Подробное описание',
    materials: 'Материалы',
    size: 'Размеры',
    care: 'Уход',
    alt: 'Описание изображений',
  };
  const clean = {} as Product;
  if (!v.slug && typeof v.name === 'string')
    v.slug = productSlug(v.name, allProducts);
  for (const [key, max] of Object.entries({
    slug: 80,
    name: 120,
    leadTime: 160,
    short: 240,
    description: 5000,
    materials: 1000,
    size: 300,
    care: 1000,
    alt: 400,
  })) {
    if (v[key] == null) v[key] = '';
    if (
      typeof v[key] !== 'string' ||
      (['slug', 'name', 'short'].includes(key) && !v[key].trim()) ||
      (v[key] as string).length > max
    )
      throw new ShopError(
        400,
        'Заполните поле «' + labels[key] + '» (не более ' + max + ' символов).'
      );
    (clean as unknown as Record<string, unknown>)[key] = (
      v[key] as string
    ).trim();
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(clean.slug))
    throw new ShopError(400, 'Адрес товара: латинские буквы, цифры и дефисы.');
  if (existing && existing.slug !== clean.slug)
    throw new ShopError(400, 'Адрес существующего товара менять нельзя.');
  const category =
    categories.find((c) => c.slug === v.categorySlug) ||
    (!v.categorySlug ? categories[0] : undefined);
  if (!category) throw new ShopError(400, 'Выберите категорию.');
  if (
    typeof v.price !== 'number' ||
    !Number.isFinite(v.price) ||
    v.price <= 0 ||
    v.price > 1_000_000 ||
    Math.abs(v.price * 100 - Math.round(v.price * 100)) > 0.000001
  )
    throw new ShopError(
      400,
      'Цена должна быть положительной, не более двух знаков после запятой.'
    );
  if (
    !Number.isSafeInteger(v.stock) ||
    (v.stock as number) < 0 ||
    (v.stock as number) > 100000
  )
    throw new ShopError(400, 'Остаток: целое число от 0 до 100 000.');
  if (typeof v.visible !== 'boolean')
    throw new ShopError(400, 'Укажите видимость товара.');
  if (
    !Array.isArray(v.gallery) ||
    v.gallery.length > 3 ||
    new Set(v.gallery).size !== v.gallery.length ||
    !v.gallery.every(
      (s) =>
        typeof s === 'string' &&
        (/^\/images\/[a-z0-9-]+\.webp$/.test(s) ||
          /^\/media\/[a-f0-9]{64}\.webp$/.test(s))
    )
  )
    throw new ShopError(400, 'Можно добавить до трёх разных фотографий.');
  if (
    !Array.isArray(v.variants) ||
    v.variants.length > 8 ||
    !v.variants.every(
      (s) => typeof s === 'string' && s.trim() && s.length <= 80
    ) ||
    new Set(v.variants).size !== v.variants.length
  )
    throw new ShopError(400, 'Варианты: до восьми разных непустых названий.');
  clean.id = existing?.id || 'ps-' + randomUUID();
  clean.category = category.name;
  clean.categorySlug = category.slug;
  clean.price = v.price;
  clean.stock = v.stock as number;
  clean.gallery = (v.gallery as string[]).length
    ? (v.gallery as string[])
    : ['/images/product-placeholder.webp'];
  clean.alt ||= clean.gallery[0].includes('product-placeholder')
    ? clean.name + ' - фотография скоро появится'
    : clean.name;
  clean.image = clean.gallery[0];
  clean.variants = v.variants.length ? (v.variants as string[]) : undefined;
  clean.tag = typeof v.tag === 'string' ? v.tag.trim().slice(0, 80) : undefined;
  return { clean, existing, v };
}
export function saveProduct(store: ShopStore, input: unknown) {
  const { clean, existing, v } = validateProduct(
    input,
    catalog(store.native, true)
  );
  return store.native
    .transaction(() => {
      store.stock(); // expire local reservations inside the same transaction
      const live = adminProducts(store).find((p) => p.id === clean.id);
      if (live && v.stockRevision !== live.stockRevision)
        throw new ShopError(
          409,
          'Остаток изменился после оплаты или редактирования. Обновите список и откройте товар заново.'
        );
      if (live && v.revision !== live.revision)
        throw new ShopError(
          409,
          'Товар уже изменён в другой вкладке. Обновите список.'
        );
      if (live && clean.stock < live.reserved)
        throw new ShopError(
          409,
          'Остаток не может быть меньше резерва: ' + live.reserved + ' шт.'
        );
      if (
        live?.reserved &&
        JSON.stringify(existing?.variants || []) !==
          JSON.stringify(clean.variants || [])
      )
        throw new ShopError(
          409,
          'Варианты нельзя менять, пока товар есть в ожидающем заказе.'
        );
      const duplicate = store.native
        .prepare('SELECT id FROM catalog WHERE slug=? AND id<>?')
        .get(clean.slug, clean.id);
      if (duplicate) throw new ShopError(409, 'Этот адрес товара уже занят.');
      store.native
        .prepare(
          'INSERT INTO inventory(id,remaining) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET remaining=excluded.remaining'
        )
        .run(clean.id, clean.stock);
      store.native
        .prepare(
          'INSERT INTO inventory_versions(id,version) VALUES(?,1) ON CONFLICT(id) DO UPDATE SET version=inventory_versions.version+1'
        )
        .run(clean.id);
      store.native
        .prepare(
          'INSERT INTO catalog(id,slug,data,visible,revision) VALUES(?,?,?,?,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,visible=excluded.visible,revision=catalog.revision+1'
        )
        .run(clean.id, clean.slug, JSON.stringify(clean), v.visible ? 1 : 0);
      return adminProducts(store).find((p) => p.id === clean.id)!;
    })
    .immediate();
}
