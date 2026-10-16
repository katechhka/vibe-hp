'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {imageSrc} from '@/lib/product-image';
import { useRouter } from 'next/navigation';
import { useShop } from './shop-context';
import { money } from '@/data/catalog';
import type { PublicOrder } from '@/lib/order-types';
import { Icon } from './icons';
const copy = {
  pending: {
    symbol: '◌',
    label: 'Ожидает демооплаты',
    title: 'Письмо ещё в пути',
    text: 'Заказ сохранён. Завершите демонстрационную оплату, чтобы проверить весь путь покупки.',
  },
  paid: {
    symbol: '✓',
    label: 'Демооплата подтверждена',
    title: 'У этой истории есть начало',
    text: 'Сервер подтвердил успешный результат демонстрации. Настоящей покупки и отправления нет.',
  },
  failed: {
    symbol: '!',
    label: 'Ошибка демооплаты',
    title: 'Попробуем ещё раз?',
    text: 'Оплата не завершилась. Ваши вещи и черновик остались на месте. Можно повторить попытку в этом заказе.',
  },
  canceled: {
    symbol: '↶',
    label: 'Демооплата отменена',
    title: 'Можно не торопиться',
    text: 'Вы отменили демонстрацию. Заказ сохранён, вещи остаются в корзине.',
  },
  expired: {
    symbol: '↶',
    label: 'Время ожидания истекло',
    title: 'Вернёмся к этой истории?',
    text: 'Резерв на 30 минут закончился. При повторной попытке сервер снова проверит наличие.',
  },
};
export function OrderStatus({
  initial,
  demo = false,
}: {
  initial: PublicOrder;
  demo?: boolean;
}) {
  const [order, setOrder] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const guard = useRef(false),
    retryKey = useRef<string | null>(null),
    cleared = useRef(false);
  const { ready, consume, storageWarning } = useShop();
  const router = useRouter();
  useEffect(() => {
    if (ready && order.status === 'paid' && !cleared.current) {
      cleared.current = true;
      consume(order.items);
      try {
        sessionStorage.removeItem('ps-checkout-request');
        sessionStorage.removeItem('ps-checkout-draft');
      } catch {}
    }
  }, [ready, order.status, order.items, consume]);
  useEffect(() => {
    if (
      order.status !== 'pending' &&
      !(
        order.status === 'paid' &&
        ['pending', 'failed'].includes(order.emailStatus)
      )
    )
      return;
    let active = true;
    const refresh = async () => {
      try {
        const r = await fetch('/api/orders/' + order.id, { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        if (active)
          setOrder((current) => {
            if (current.status === 'paid' && data.order.status !== 'paid')
              return current;
            if (
              current.activeAttempt === data.order.activeAttempt &&
              current.status !== 'pending' &&
              data.order.status === 'pending'
            )
              return current;
            return data.order;
          });
      } catch {}
    };
    const timer = setInterval(refresh, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [order.id, order.status, order.emailStatus]);
  async function action(kind: 'retry' | 'demo', result?: string) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError('');
    try {
      if (kind === 'retry') retryKey.current ||= crypto.randomUUID();
      const r = await fetch('/api/orders/' + order.id + '/' + kind, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          kind === 'retry'
            ? { requestKey: retryKey.current }
            : { attemptId: order.activeAttempt, result }
        ),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Не удалось обновить заказ.');
      setOrder(data.order);
      if (kind === 'retry') retryKey.current = null;
      router.push(
        '/orders/' +
          order.id +
          (kind === 'retry' &&
          data.order.status === 'pending' &&
          data.order.mode === 'demo'
            ? '/demo'
            : '')
      );
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Не удалось связаться с сервером. Повторите попытку.'
      );
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }
  const s = {
      ...copy[order.status],
      label:
        order.mode === 'yookassa_test'
          ? {
              pending: 'Ожидает подтверждения',
              paid: 'Тестовая оплата подтверждена',
              failed: 'Ошибка тестовой оплаты',
              canceled: 'Тестовая оплата отменена',
              expired: 'Срок ожидания истёк',
            }[order.status]
          : copy[order.status].label,
    },
    isDemo = demo && order.mode === 'demo' && order.status === 'pending';
  const provider = order.mode === 'yookassa_test';
  const statusText = provider
    ? {
        pending:
          'Заказ сохранён. Продолжите оплату тестовой картой на защищённой странице ЮKassa. Статус проверяет сервер.',
        paid: 'API ЮKassa подтвердил успешную тестовую оплату. Настоящей покупки и доставки нет.',
        failed:
          'ЮKassa отклонила тестовую оплату. Можно повторить её в этом же заказе.',
        canceled:
          'ЮKassa подтвердила отмену тестового платежа. Заказ сохранён; можно повторить оплату.',
        expired:
          'Платёж завершён без оплаты. Можно проверить наличие и повторить оплату.',
      }[order.status]
    : s.text;
  return (
    <div className="container page-space">
      <div className="preview-banner">
        <strong>
          {provider ? 'Тестовый магазин ЮKassa' : 'Локальная демонстрация'}
        </strong>
        <span>
          {provider
            ? 'Используйте только тестовые карты. Настоящие деньги не списываются.'
            : 'ЮKassa не подключена. Карта не нужна, деньги не списываются.'}
        </span>
      </div>
      <div className="payment-result">
        <div
          className={
            'result-symbol result-symbol--' +
            (order.status === 'paid'
              ? 'success'
              : order.status === 'failed'
                ? 'error'
                : order.status)
          }
          aria-hidden="true"
        >
          {isDemo ? '✧' : s.symbol}
        </div>
        <p className="eyebrow">
          {isDemo ? 'Проверка сценария покупки' : s.label}
        </p>
        <h1>{isDemo ? 'Как закончится эта история?' : s.title}</h1>
        <p>
          {isDemo
            ? 'Выберите исход локальной оплаты. Результат сохранится в базе заказов; его можно проверить после обновления страницы.'
            : statusText}
        </p>
        <div className="result-order">
          <div className="result-order-heading">
            <span>Заказ № {order.number}</span>
            <span data-testid="order-status">{s.label}</span>
          </div>
          {order.items.map((line) => (
            <div className="result-order-item" key={line.id + line.variant}>
              <Image
                src={imageSrc(line.image)}
                width={75}
                height={94}
                alt={line.name}
              />
              <div>
                <Link href={'/products/' + line.slug}>
                  <strong>{line.name}</strong>
                </Link>
                <span>
                  {line.variant || 'Авторская работа'} · {line.quantity} шт.
                </span>
              </div>
              <strong>{money((line.unitPrice * line.quantity) / 100)}</strong>
            </div>
          ))}
          <div className="summary-row">
            <span>Вещи</span>
            <span>{money(order.subtotal / 100)}</span>
          </div>
          <div className="summary-row">
            <span>{order.deliveryLabel}</span>
            <span>{money(order.shipping / 100)}</span>
          </div>
          <div className="summary-total">
            <span>Итого</span>
            <strong>{money(order.total / 100)}</strong>
          </div>
        </div>
        {order.status === 'paid' && (
          <p
            className="receipt-note"
            role="status"
            data-testid="receipt-status"
          >
            {order.emailStatus === 'sent'
              ? 'Почтовый сервис принял письмо с составом заказа. Проверьте входящие и папку «Спам».'
              : order.emailStatus === 'pending'
                ? 'Готовим письмо с составом заказа на указанную при оформлении почту.'
                : order.emailStatus === 'not_configured'
                  ? 'Письмо с составом заказа подготовлено, но почтовый сервис пока не настроен.'
                  : order.emailStatus === 'failed'
                    ? 'Письмо пока не удалось отправить. Заказ подтверждён; сервер сохранит письмо для повторной попытки.'
                    : order.emailStatus === 'review'
                      ? 'Заказ подтверждён. Отправка письма требует проверки разработчиком.'
                      : 'Для этого заказа письмо не запланировано.'}
          </p>
        )}
        {order.paymentError && (
          <p role="status" className="stage-note">
            {order.paymentError}
          </p>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        {storageWarning && (
          <p role="status" className="stage-note">
            {storageWarning}
          </p>
        )}
        <div className="payment-actions" aria-busy={busy}>
          {isDemo ? (
            <>
              <button
                className="button"
                disabled={busy}
                onClick={() => action('demo', 'succeeded')}
              >
                {busy ? 'Сохраняем результат…' : 'Успешная демооплата'}
                <Icon name="check" size={18} />
              </button>
              <div className="demo-secondary">
                <button
                  className="button button--outline"
                  disabled={busy}
                  onClick={() => action('demo', 'failed')}
                >
                  Проверить ошибку
                </button>
                <button
                  className="plain-button"
                  disabled={busy}
                  onClick={() => action('demo', 'canceled')}
                >
                  Отменить демооплату
                </button>
              </div>
            </>
          ) : order.status === 'pending' && provider ? (
            <>
              {order.confirmationUrl && (
                <a
                  className="button"
                  href={order.confirmationUrl}
                  rel="noreferrer"
                >
                  К тестовой оплате в ЮKassa <Icon name="arrow" size={18} />
                </a>
              )}
              {(!order.confirmationUrl || order.paymentError) && (
                <button
                  className="button button--outline"
                  disabled={busy}
                  onClick={() => action('retry')}
                >
                  {busy ? 'Проверяем платёж…' : 'Подготовить тестовый платёж'}
                </button>
              )}
            </>
          ) : order.status === 'pending' ? (
            <Link className="button" href={'/orders/' + order.id + '/demo'}>
              К демонстрационной оплате
              <Icon name="arrow" size={18} />
            </Link>
          ) : order.status !== 'paid' ? (
            <button
              className="button"
              disabled={busy}
              onClick={() => action('retry')}
            >
              {busy
                ? 'Проверяем наличие…'
                : provider
                  ? 'Повторить тестовую оплату'
                  : 'Повторить демооплату'}
              <Icon name="arrow" size={18} />
            </button>
          ) : (
            <Link className="button" href="/catalog">
              Вернуться в мастерскую
              <Icon name="arrow" size={18} />
            </Link>
          )}
          {order.status !== 'paid' && (
            <Link className="text-link" href="/checkout">
              Вернуться к оформлению
            </Link>
          )}
          <button
            className="plain-button"
            disabled={busy}
            onClick={async () => {
              setError('');
              try {
                const r = await fetch('/api/orders/' + order.id, {
                  cache: 'no-store',
                });
                const data = await r.json();
                if (!r.ok) throw new Error(data.error);
                setOrder(data.order);
              } catch (e) {
                setError(
                  e instanceof Error
                    ? e.message
                    : 'Не удалось проверить статус.'
                );
              }
            }}
          >
            Обновить статус
          </button>
        </div>
        <p className="stage-caption">
          Доступ к заказу открыт только в браузере оформления.
          <br />
          Статус берётся из базы, адрес страницы его не меняет.
        </p>
      </div>
    </div>
  );
}
