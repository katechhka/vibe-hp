'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { imageSrc } from '@/lib/product-image';
import { useShop } from './shop-context';
import { money, deliveryOptions } from '@/data/catalog';
import { useCatalog } from './catalog-context';
import { Icon } from './icons';
import {
  initialCheckout,
  restoreDraft,
  validateCheckout,
  fieldLimits,
  checkoutTotal,
  type CheckoutFields,
  type CheckoutErrors,
} from '@/lib/checkout';
import { cartSubtotal } from '@/lib/cart';
type Fields = CheckoutFields;
const initial = initialCheckout;
export function Checkout() {
  const products = useCatalog();
  const { items, ready, storageWarning, snapshot } = useShop();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [paymentMode, setPaymentMode] = useState<
    'demo' | 'yookassa_test' | null
  >(null);
  useEffect(() => {
    fetch('/api/payments/config', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = await r.json();
        setPaymentMode(data.mode);
      })
      .catch(() =>
        setNotice('Не удалось загрузить способ оплаты. Обновите страницу.')
      );
  }, []);
  const [lastOrder, setLastOrder] = useState('');
  const guard = useRef(false);
  const requestRecord = useRef<{
    fingerprint: string;
    key: string;
    orderId?: string;
  } | null>(null);
  const [fields, setFields] = useState<Fields>(initial);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<CheckoutErrors>({});
  const [notice, setNotice] = useState('');
  const [draftWarning, setDraftWarning] = useState('');
  useEffect(() => {
    try {
      setFields(
        restoreDraft(
          JSON.parse(sessionStorage.getItem('ps-checkout-draft') || 'null')
        )
      );
    } catch {
      setDraftWarning(
        'Не удалось восстановить черновик. Заполните форму заново.'
      );
    }
    try {
      const saved = JSON.parse(
        sessionStorage.getItem('ps-checkout-request') || 'null'
      );
      if (
        saved &&
        typeof saved.fingerprint === 'string' &&
        typeof saved.key === 'string'
      ) {
        requestRecord.current = saved;
        if (typeof saved.orderId === 'string') setLastOrder(saved.orderId);
      }
    } catch {}
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) {
      try {
        sessionStorage.setItem(
          'ps-checkout-draft',
          JSON.stringify({ ...fields, consent: false, demo: false })
        );
      } catch {
        setDraftWarning(
          'Не удалось сохранить черновик. Браузер ограничивает хранение данных; оставьте эту страницу открытой.'
        );
      }
    }
  }, [fields, loaded]);
  function field(key: keyof Fields, value: string | boolean) {
    setFields((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
    setNotice('');
  }
  const input = (
    key:
      'name' | 'email' | 'phone' | 'city' | 'pickupAddress' | 'courierAddress',
    label: string,
    type = 'text',
    placeholder = '',
    autoComplete = ''
  ) => (
    <div className={'field' + (errors[key] ? ' field--error' : '')}>
      <label htmlFor={key}>{label}</label>
      <input
        id={key}
        name={key}
        disabled={busy}
        maxLength={fieldLimits[key]}
        type={type}
        value={fields[key]}
        onChange={(e) => field(key, e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? key + '-error' : undefined}
      />
      {errors[key] && (
        <span id={key + '-error'} className="field-error">
          {errors[key]}
        </span>
      )}
    </div>
  );
  if (!ready || !loaded) return <p className="loading-note">Готовим форму…</p>;
  if (!items.length)
    return (
      <div className="empty-state">
        <Icon name="bag" size={42} />
        <h2>Сначала найдём вашу вещь</h2>
        <p>Для оформления добавьте что-нибудь в корзину.</p>
        <Link className="button" href="/catalog">
          В каталог
          <Icon name="arrow" />
        </Link>
      </div>
    );
  const delivery = deliveryOptions.find((o) => o.id === fields.delivery)!;
  const subtotal = cartSubtotal(items, products) / 100;
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (guard.current || !paymentMode) return;
    const next = validateCheckout(fields);
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      );
      return;
    }
    guard.current = true;
    setBusy(true);
    setNotice('');
    const lines = snapshot(),
      fingerprint = JSON.stringify({ fields, items: lines });
    if (requestRecord.current?.fingerprint !== fingerprint)
      requestRecord.current = { fingerprint, key: crypto.randomUUID() };
    const pending = requestRecord.current!;
    try {
      sessionStorage.setItem('ps-checkout-request', JSON.stringify(pending));
    } catch {
      setDraftWarning(
        'Браузер не сохраняет данные. После перехода к оплате держите страницу заказа открытой.'
      );
    }
    try {
      const r = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestKey: pending.key,
          fields,
          items: lines,
          expectedTotal: checkoutTotal(items, fields.delivery, products),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        if (data.fields) setErrors(data.fields);
        throw new Error(data.error || 'Не удалось сохранить заказ.');
      }
      pending.orderId = data.order.id;
      setLastOrder(data.order.id);
      try {
        sessionStorage.setItem('ps-checkout-request', JSON.stringify(pending));
      } catch {}
      router.push(
        '/orders/' +
          data.order.id +
          (data.order.status === 'pending' && data.order.mode === 'demo'
            ? '/demo'
            : '')
      );
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : 'Нет связи с сервером. Повторите попытку: второй заказ не появится.'
      );
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="checkout-layout">
      <form
        onSubmit={submit}
        noValidate
        className="checkout-form"
        aria-busy={busy}
      >
        {lastOrder && (
          <p className="stage-note">
            У вас есть сохранённый заказ.{' '}
            <Link className="text-link" href={'/orders/' + lastOrder}>
              Посмотреть статус и повторить оплату →
            </Link>
          </p>
        )}
        {draftWarning && (
          <p role="status" className="stage-note">
            {draftWarning}
          </p>
        )}
        {storageWarning && (
          <p role="status" className="stage-note">
            {storageWarning}
          </p>
        )}
        <section className="form-section">
          <div className="form-section-title">
            <span>01</span>
            <h2>Как к вам обращаться?</h2>
          </div>
          <p className="form-hint">
            Для проверки используйте вымышленные имя и телефон. Укажите свою
            почту, если хотите получить письмо после подтверждённой тестовой
            оплаты.
          </p>
          <div className="form-grid">
            {input('name', 'Ваше имя', 'text', 'Например, Ася', 'given-name')}
            {input('email', 'Email', 'email', 'asya@example.com', 'email')}
            {input('phone', 'Телефон', 'tel', '+7 999 123-45-67', 'tel')}
          </div>
        </section>
        <section className="form-section">
          <div className="form-section-title">
            <span>02</span>
            <h2>Куда отправить?</h2>
          </div>
          <fieldset className="delivery-choice">
            <legend className="sr-only">Способ доставки</legend>
            {deliveryOptions.map((o) => (
              <label key={o.id}>
                <input
                  disabled={busy}
                  type="radio"
                  name="delivery"
                  checked={fields.delivery === o.id}
                  onChange={() => field('delivery', o.id)}
                />
                <span>
                  <strong>{o.label}</strong>
                  <small>{o.time}</small>
                </span>
                <b>{money(o.price)}</b>
              </label>
            ))}
          </fieldset>
          <div className="form-grid">
            {input('city', 'Город', 'text', 'Москва', 'address-level2')}
            <div className="full-field">
              {input(
                fields.delivery === 'pickup'
                  ? 'pickupAddress'
                  : 'courierAddress',
                fields.delivery === 'pickup'
                  ? 'Адрес пункта выдачи'
                  : 'Улица, дом, квартира',
                'text',
                fields.delivery === 'pickup'
                  ? 'Укажите условный адрес пункта'
                  : 'Улица, дом, квартира',
                'street-address'
              )}
            </div>
          </div>
          <p className="form-hint">
            Демонстрационные тарифы. Реальный перевозчик не подключён.
          </p>
        </section>
        <section className="form-section">
          <div className="form-section-title">
            <span>03</span>
            <h2>Что-нибудь ещё?</h2>
          </div>
          <label className="field">
            <span>
              Комментарий <small>необязательно</small>
            </span>
            <textarea
              disabled={busy}
              rows={3}
              name="comment"
              maxLength={fieldLimits.comment}
              value={fields.comment}
              onChange={(e) => field('comment', e.target.value)}
              placeholder="Например, это подарок — не вкладывайте открытку внутрь блокнота."
            />
          </label>
        </section>
        <div className="consents">
          <label>
            <input
              disabled={busy}
              type="checkbox"
              checked={fields.consent}
              onChange={(e) => field('consent', e.target.checked)}
              aria-invalid={!!errors.consent}
            />
            <span>
              Согласен с обработкой данных заказа и отправкой письма с его
              составом на указанную почту.{' '}
              <Link href="/privacy">Как они хранятся</Link>
              {errors.consent && (
                <small className="field-error">{errors.consent}</small>
              )}
            </span>
          </label>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={fields.demo}
              onChange={(e) => field('demo', e.target.checked)}
              aria-invalid={!!errors.demo}
            />
            <span>
              Понимаю, что это демоверсия: настоящей покупки и доставки нет.
              {errors.demo && (
                <small className="field-error">{errors.demo}</small>
              )}
            </span>
          </label>
        </div>
        <button
          disabled={busy}
          className="plain-button clear-draft"
          type="button"
          onClick={() => {
            setFields(initial);
            setErrors({});
            setNotice('Черновик очищен.');
            try {
              sessionStorage.removeItem('ps-checkout-draft');
            } catch {}
          }}
        >
          Очистить черновик
        </button>
        <div role="status" className="stage-note checkout-notice">
          {notice && <p>{notice}</p>}
        </div>
        <Link className="text-link" href="/cart">
          <Icon name="left" size={18} />
          Вернуться в корзину
        </Link>
      </form>
      <aside className="order-summary checkout-summary">
        <p className="eyebrow">Всё на одной странице</p>
        <h2>Ваш заказ</h2>
        <div className="mini-cart">
          {items.map((i) => {
            const p = products.find((p) => p.id === i.id)!;
            return (
              <div key={i.id + i.variant}>
                <Image src={imageSrc(p.image)} alt="" width={56} height={70} />
                <div>
                  <Link href={'/products/' + p.slug}>{p.name}</Link>
                  <small>
                    {i.variant || 'Авторская работа'} · {i.quantity} шт.
                  </small>
                </div>
                <span>{money(p.price * i.quantity)}</span>
              </div>
            );
          })}
        </div>
        <div className="summary-row">
          <span>Вещи</span>
          <span>{money(subtotal)}</span>
        </div>
        <div className="summary-row">
          <span>{delivery.label}</span>
          <span>{money(delivery.price)}</span>
        </div>
        <div className="summary-total">
          <span>Итого</span>
          <strong>{money(checkoutTotal(items, fields.delivery, products) / 100)}</strong>
        </div>
        <div className="payment-disclosure">
          <Icon name="star" size={20} />
          <p>
            {paymentMode === 'yookassa_test' ? (
              <>
                <strong>Тестовая оплата через ЮKassa.</strong> Данные тестовой
                карты вводятся на странице ЮKassa. Настоящие карты использовать
                нельзя; деньги не списываются.
              </>
            ) : paymentMode === 'demo' ? (
              <>
                <strong>Это локальная демонстрация.</strong> Вы сами выберете
                результат оплаты. Настоящие деньги не списываются.
              </>
            ) : (
              'Загружаем способ тестовой оплаты…'
            )}
          </p>
        </div>
        <button
          className="button"
          disabled={busy || !paymentMode}
          type="button"
          onClick={() =>
            document
              .querySelector<HTMLFormElement>('.checkout-form')
              ?.requestSubmit()
          }
        >
          {busy
            ? 'Сохраняем заказ…'
            : paymentMode === 'yookassa_test'
              ? 'К тестовой оплате'
              : 'К демонстрационной оплате'}
          <Icon name="arrow" size={18} />
        </button>
        <p className="stage-caption">
          Заказ сохраняется на сервере.{' '}
          {paymentMode === 'yookassa_test'
            ? 'Используйте только тестовую карту.'
            : 'Карта не нужна.'}
        </p>
      </aside>
    </div>
  );
}
