'use client';
import { PrivacyConsent } from './privacy-consent';
import { productSlug } from '@/lib/product-slug';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { categories, money, type Product } from '@/data/catalog';
import { imageSrc } from '@/lib/product-image';
import type { CheckoutFields } from '@/lib/checkout';
import type { OrderLine } from '@/lib/order-types';
type AdminProduct = Product & {
  reserved: number;
  available: number;
  stockRevision: number;
};
type OrderSummary = {
  id: string;
  number: string;
  status: string;
  total: number;
  created_at: number;
};
type AdminOrder = OrderSummary & {
  customer: CheckoutFields;
  items: OrderLine[];
  shipping: number;
  subtotal: number;
  delivery_label: string;
};
const status: Record<string, string> = {
  pending: 'Ожидает оплаты',
  paid: 'Оплачен',
  failed: 'Ошибка оплаты',
  canceled: 'Отменён',
  expired: 'Резерв истёк',
};
async function api(action: string, value?: unknown) {
  const response = await fetch('/api/admin/' + action, {
    method: value === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    headers: value === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const data = await response.json();
  if (response.status === 401 && action !== 'login') {
    window.location.assign('/admin/login');
    throw new Error('Войдите снова.');
  }
  if (!response.ok)
    throw new Error(data.error || 'Не удалось выполнить действие.');
  return data;
}
export function AdminLogin() {
  const router = useRouter(),
    guard = useRef(false);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="container page-space admin-login">
      <p className="eyebrow">Для автора мастерской</p>
      <h1>Войти в мастерскую</h1>
      <p>Один закрытый аккаунт — admin. Здесь живут товары и заказы.</p>
      <form
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (guard.current) return;
          if (!privacyConsent) {
            setError('Подтвердите согласие на обработку данных.');
            return;
          }
          guard.current = true;
          setBusy(true);
          setError('');
          try {
            await api('login', { password, privacyConsent });
            router.replace('/admin');
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Не удалось войти.');
          } finally {
            guard.current = false;
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>Пароль</span>
          <input
            required
            type="password"
            autoComplete="current-password"
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        <PrivacyConsent
          id="login-privacy"
          error={
            !privacyConsent && error.includes('согласие') ? error : undefined
          }
          checked={privacyConsent}
          onChange={setPrivacyConsent}
          disabled={busy}
        />
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <button className="button" disabled={busy}>
          {busy ? 'Открываем…' : 'Войти'}
        </button>
      </form>
      <Link className="text-link" href="/">
        Вернуться в магазин →
      </Link>
    </div>
  );
}
const blank = () => ({
  slug: '',
  name: '',
  categorySlug: 'paper',
  price: 0,
  stock: 0,
  leadTime: '',
  short: '',
  description: '',
  materials: '',
  size: '',
  care: '',
  alt: '',
  gallery: [] as string[],
  variants: [] as string[],
  visible: false,
  tag: '',
});
export function AdminPanel() {
  const router = useRouter(),
    guard = useRef(false);
  const [tab, setTab] = useState<'products' | 'orders' | 'settings'>(
      'products'
    ),
    [products, setProducts] = useState<AdminProduct[]>([]),
    [orders, setOrders] = useState<OrderSummary[]>([]);
  const [draft, setDraft] = useState<
      (Partial<AdminProduct> & ReturnType<typeof blank>) | null
    >(null),
    [variants, setVariants] = useState('');
  const [editorConsent, setEditorConsent] = useState(false),
    [passwordConsent, setPasswordConsent] = useState(false);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<AdminOrder | null>(null),
    [current, setCurrent] = useState(''),
    [next, setNext] = useState('');
  const refresh = async () => {
    const [p, o] = await Promise.all([api('products'), api('orders')]);
    setProducts(p.products);
    setOrders(o.orders);
  };
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (error)
      document
        .querySelector('p[role=alert]')
        ?.scrollIntoView({ block: 'center' });
  }, [error]);
  async function run(fn: () => Promise<void>) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Попробуйте ещё раз.');
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  function open(p?: AdminProduct) {
    setEditorConsent(false);
    setDraft(
      p
        ? {
            ...blank(),
            ...p,
            gallery: p.gallery || [imageSrc(p.image)],
            variants: p.variants || [],
          }
        : blank()
    );
    setVariants(p?.variants?.join('\n') || '');
    setError('');
    setNotice('');
  }
  const input = (
    key: keyof ReturnType<typeof blank>,
    label: string,
    multiline = false,
    type = 'text'
  ) => (
    <label className="field" key={key}>
      <span>{label}</span>
      {multiline ? (
        <textarea
          rows={key === 'description' ? 5 : 2}
          required={key === 'short'}
          value={String(draft?.[key] ?? '')}
          maxLength={key === 'description' ? 5000 : 1000}
          disabled={busy}
          onChange={(e) =>
            setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))
          }
        />
      ) : (
        <input
          required={['name', 'price', 'short'].includes(key)}
          type={type}
          step={
            type === 'number' ? (key === 'price' ? '0.01' : '1') : undefined
          }
          min={type === 'number' ? 0 : undefined}
          maxLength={key === 'slug' ? 80 : key === 'alt' ? 400 : 240}
          readOnly={key === 'slug'}
          value={String(draft?.[key] ?? '')}
          disabled={busy}
          onChange={(e) =>
            setDraft((d) =>
              d
                ? {
                    ...d,
                    ...(key === 'name' && !d.id
                      ? { slug: productSlug(e.target.value, products) }
                      : {}),
                    [key]:
                      type === 'number'
                        ? Number(e.target.value)
                        : e.target.value,
                  }
                : d
            )
          }
        />
      )}
    </label>
  );
  return (
    <div className="container page-space admin">
      <div className="admin-heading">
        <div>
          <p className="eyebrow">За кулисами мастерской</p>
          <h1>Товары и заказы</h1>
        </div>
        <button
          className="plain-button"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api('logout', {});
              router.replace('/admin/login');
              router.refresh();
            })
          }
        >
          Выйти
        </button>
      </div>
      <div
        className="admin-tabs"
        role="tablist"
        aria-label="Разделы управления"
      >
        {[
          ['products', 'Товары'],
          ['orders', 'Заказы'],
          ['settings', 'Доступ'],
        ].map(([id, title]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            disabled={busy}
            onClick={() => {
              setTab(id as typeof tab);
              if (id === 'products') setDraft(null);
              setError('');
              setNotice('');
            }}
          >
            {title}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="stage-note field-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="stage-note">
          {notice}
        </p>
      )}
      {loading ? (
        <p className="loading-note">Открываем записи мастерской…</p>
      ) : tab === 'products' ? (
        <div className="admin-products">
          <div className="admin-toolbar">
            <p>{products.length} товаров · цены в рублях</p>
            <button className="button" disabled={busy} onClick={() => open()}>
              Добавить товар
            </button>
            <button
              className="plain-button"
              disabled={busy}
              onClick={() => run(refresh)}
            >
              Обновить список
            </button>
          </div>
          {draft ? (
            <form
              noValidate
              className="admin-editor"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  if (!editorConsent)
                    throw Error('Подтвердите согласие на обработку данных.');
                  const result = await api('save', {
                    ...draft,
                    privacyConsent: editorConsent,
                    variants: variants
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  });
                  await refresh();
                  open(result.product);
                  setNotice(
                    'Товар сохранён. Изменения уже доступны в магазине.'
                  );
                  router.refresh();
                });
              }}
            >
              <PrivacyConsent
                id="editor-privacy"
                error={
                  !editorConsent && error.includes('согласие')
                    ? error
                    : undefined
                }
                checked={editorConsent}
                onChange={setEditorConsent}
                disabled={busy}
              />
              <div className="admin-editor-heading">
                <h2>{draft.id ? 'Редактировать товар' : 'Новая вещь'}</h2>
                <button
                  type="button"
                  className="plain-button"
                  disabled={busy}
                  onClick={() => {
                    setDraft(null);
                    setError('');
                    setNotice('');
                  }}
                >
                  ← К списку товаров
                </button>
              </div>
              <div className="form-grid">
                {input('name', 'Название')}
                {input('slug', 'Адрес страницы (латиницей)')}
                <label className="field">
                  <span>Категория</span>
                  <select
                    value={draft.categorySlug}
                    disabled={busy}
                    onChange={(e) =>
                      setDraft((d) =>
                        d ? { ...d, categorySlug: e.target.value } : d
                      )
                    }
                  >
                    {categories.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {input('price', 'Цена, ₽', false, 'number')}
                {input('stock', 'Физический остаток, шт.', false, 'number')}
                {input('leadTime', 'Срок изготовления и отправки')}
                {input('short', 'Краткое описание')}
                {input('tag', 'Подпись на карточке (необязательно)')}
              </div>
              <p className="form-hint">
                Резерв: {draft.reserved || 0} шт. Доступно:{' '}
                {Math.max(0, draft.stock - (draft.reserved || 0))} шт. Остаток
                включает зарезервированные вещи. Адрес существующего товара
                сохраняется.
              </p>
              {input('description', 'Подробное описание', true)}
              <div className="form-grid">
                {input('materials', 'Материалы', true)}
                {input('size', 'Размеры', true)}
                {input('care', 'Уход', true)}
                {input('alt', 'Описание изображений для незрячих', true)}
              </div>
              <label className="field">
                <span>Варианты — по одному в строке (необязательно)</span>
                <textarea
                  rows={3}
                  value={variants}
                  disabled={busy}
                  onChange={(e) => setVariants(e.target.value)}
                />
              </label>
              <fieldset className="admin-images">
                <legend>Фотографии · до 3 изображений (необязательно)</legend>
                <div className="admin-image-grid">
                  {draft.gallery.map((src, i) => (
                    <div key={src + i}>
                      <img
                        src={src}
                        alt={'Фото ' + (i + 1)}
                        width={160}
                        height={200}
                      />
                      <span>{i === 0 ? 'Обложка' : 'Фото ' + (i + 1)}</span>
                      <button
                        type="button"
                        className="plain-button"
                        disabled={busy}
                        onClick={() =>
                          setDraft((d) =>
                            d
                              ? {
                                  ...d,
                                  gallery: d.gallery.filter((_, n) => n !== i),
                                }
                              : d
                          )
                        }
                      >
                        Убрать фото {i + 1}
                      </button>
                      {i > 0 && (
                        <button
                          type="button"
                          className="plain-button"
                          disabled={busy}
                          onClick={() =>
                            setDraft((d) =>
                              d
                                ? {
                                    ...d,
                                    gallery: [
                                      src,
                                      ...d.gallery.filter((_, n) => n !== i),
                                    ],
                                  }
                                : d
                            )
                          }
                        >
                          Сделать обложкой
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <label className="field">
                  <span>
                    Загрузить JPEG, PNG, WebP или AVIF · до 4 МБ, от 300 × 300
                    px
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/avif"
                    disabled={busy || draft.gallery.length >= 3}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (!file) return;
                      if (!editorConsent) {
                        setError(
                          'Перед загрузкой подтвердите согласие на обработку данных.'
                        );
                        return;
                      }
                      run(async () => {
                        if (file.size > 4_000_000)
                          throw Error('Максимальный размер — 4 МБ.');
                        const response = await fetch('/api/admin/upload', {
                          method: 'POST',
                          body: file,
                          headers: {
                            'Content-Type': file.type,
                            'X-Privacy-Consent': 'true',
                          },
                        });
                        const result = await response.json();
                        if (!response.ok) throw Error(result.error);
                        setDraft((d) =>
                          d
                            ? {
                                ...d,
                                gallery: [
                                  ...d.gallery.filter(
                                    (src) =>
                                      !src.includes('product-placeholder')
                                  ),
                                  result.url,
                                ],
                              }
                            : d
                        );
                        setNotice(
                          'Фото загружено. Сохраните товар, чтобы добавить его на витрину.'
                        );
                      });
                    }}
                  />
                </label>
              </fieldset>
              <label className="admin-visibility">
                <input
                  type="checkbox"
                  checked={draft.visible}
                  disabled={busy}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, visible: e.target.checked } : d
                    )
                  }
                />
                Показывать в магазине
              </label>
              <p className="form-hint">
                Скрытый товар остаётся в базе и старых заказах. Фотографии не
                удаляются, чтобы сохранять историю покупок.
              </p>
              <button className="button" disabled={busy}>
                {busy ? 'Сохраняем…' : 'Сохранить товар'}
              </button>
              <button
                type="button"
                className="plain-button"
                disabled={busy}
                onClick={() => {
                  setDraft(null);
                  setError('');
                  setNotice('');
                }}
              >
                К списку товаров
              </button>
            </form>
          ) : (
            <div className="admin-list">
              {products.map((p) => (
                <article className="admin-product" key={p.id}>
                  <img src={imageSrc(p.image)} alt="" width={64} height={80} />
                  <div>
                    <h2>{p.name}</h2>
                    <p>
                      {p.category} · {p.visible ? 'На витрине' : 'Скрыт'}
                    </p>
                  </div>
                  <div>
                    <strong>{money(p.price)}</strong>
                    <p>
                      Остаток {p.stock} · резерв {p.reserved} · доступно{' '}
                      {p.available}
                    </p>
                  </div>
                  <button
                    className="text-link"
                    disabled={busy}
                    onClick={() => open(p)}
                  >
                    Изменить
                  </button>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : tab === 'orders' ? (
        <div>
          <div className="admin-toolbar">
            <p>Последние 100 заказов · только просмотр</p>
            <button
              className="plain-button"
              disabled={busy}
              onClick={() => run(refresh)}
            >
              Обновить заказы
            </button>
          </div>
          {detail ? (
            <section className="admin-editor">
              <button className="text-link" onClick={() => setDetail(null)}>
                ← Все заказы
              </button>
              <h2>{detail.number}</h2>
              <p>
                {status[detail.status]} · {money(detail.total / 100)}
              </p>
              <h3>Покупатель и доставка</h3>
              <p>
                {detail.customer.name} · {detail.customer.email} ·{' '}
                {detail.customer.phone}
              </p>
              <p>
                {detail.customer.city},{' '}
                {detail.customer.pickupAddress ||
                  detail.customer.courierAddress}
              </p>
              <p>
                {detail.delivery_label} · {money(detail.shipping / 100)}
              </p>
              {detail.customer.comment && (
                <p>Комментарий: {detail.customer.comment}</p>
              )}
              <h3>Состав заказа</h3>
              {detail.items.map((i) => (
                <p key={i.id + i.variant}>
                  {i.name}
                  {i.variant ? ' · ' + i.variant : ''} — {i.quantity} шт. ×{' '}
                  {money(i.unitPrice / 100)}
                </p>
              ))}
              <p className="form-hint">
                Контактные данные доступны только после входа. Статусы оплаты
                меняются через подтверждённый результат, вручную отметить заказ
                оплаченным нельзя.
              </p>
            </section>
          ) : (
            <div className="admin-list">
              {orders.length ? (
                orders.map((o) => (
                  <article className="admin-order" key={o.id}>
                    <div>
                      <strong>{o.number}</strong>
                      <p>{new Date(o.created_at).toLocaleString('ru-RU')}</p>
                    </div>
                    <span>{status[o.status]}</span>
                    <strong>{money(o.total / 100)}</strong>
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() =>
                        run(async () =>
                          setDetail((await api('orders?id=' + o.id)).order)
                        )
                      }
                    >
                      Посмотреть
                    </button>
                  </article>
                ))
              ) : (
                <p className="empty-state">Заказов пока нет.</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <section className="admin-editor">
          <h2>Сменить пароль</h2>
          <p>После смены все сеансы завершатся. Войдите с новым паролем.</p>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                if (!passwordConsent)
                  throw Error('Подтвердите согласие на обработку данных.');
                await api('password', {
                  current,
                  next,
                  privacyConsent: passwordConsent,
                });
                router.replace('/admin/login');
                router.refresh();
              });
            }}
          >
            <label className="field">
              <span>Текущий пароль</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={current}
                maxLength={128}
                disabled={busy}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Новый пароль — минимум 12 символов</span>
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                value={next}
                disabled={busy}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <PrivacyConsent
              id="password-privacy"
              error={
                !passwordConsent && error.includes('согласие')
                  ? error
                  : undefined
              }
              checked={passwordConsent}
              onChange={setPasswordConsent}
              disabled={busy}
            />
            <button className="button" disabled={busy}>
              {busy ? 'Обновляем…' : 'Сменить пароль'}
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
