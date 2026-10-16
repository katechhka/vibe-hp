import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { Icon } from '@/components/icons';
export const metadata: Metadata = {
  title: 'Макеты результата оплаты',
  robots: { index: false, follow: false },
};
const states = {
  pending: {
    title: 'Письмо ещё в пути',
    text: 'Проверяем подтверждение оплаты. Обычно это занимает несколько секунд.',
    label: 'Ожидаем подтверждения',
    symbol: '◌',
  },
  success: {
    title: 'У этой истории есть начало',
    text: 'Здесь появится подтверждение, когда сервер проверит успешный тестовый платёж.',
    label: 'Макет успешной оплаты',
    symbol: '✓',
  },
  error: {
    title: 'Попробуем ещё раз?',
    text: 'Если оплатить не удалось, можно повторить попытку в том же заказе.',
    label: 'Макет ошибки оплаты',
    symbol: '!',
  },
  canceled: {
    title: 'Можно не торопиться',
    text: 'После отмены оплаты ваши вещи и введённые данные останутся на месте.',
    label: 'Макет отмены оплаты',
    symbol: '↶',
  },
};
export default async function PaymentPreview({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const params = await searchParams;
  const key =
    params.state && Object.hasOwn(states, params.state)
      ? (params.state as keyof typeof states)
      : 'pending';
  const s = states[key];
  return (
    <div className="container page-space">
      <div className="preview-banner">
        <strong>Предпросмотр дизайна</strong>
        <span>Это макет. Заказ и платёж не существуют.</span>
      </div>
      <nav className="status-tabs" aria-label="Макеты статусов">
        {[
          ['pending', 'Ожидание'],
          ['success', 'Успех'],
          ['error', 'Ошибка'],
          ['canceled', 'Отмена'],
        ].map(([id, label]) => (
          <Link
            key={id}
            href={'/preview/payment?state=' + id}
            aria-current={id === key ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <div className="payment-result">
        <div
          className={'result-symbol result-symbol--' + key}
          aria-hidden="true"
        >
          {s.symbol}
        </div>
        <p className="eyebrow">{s.label}</p>
        <h1>{s.title}</h1>
        <p>{s.text}</p>
        <div className="result-order">
          <div className="result-order-heading">
            <span>Пример заказа № DEMO-001</span>
            <span>Не сохранён</span>
          </div>
          <div className="result-order-item">
            <Image
              src="/images/night-library.webp"
              width={75}
              height={94}
              alt="Бордовый блокнот с золотой луной"
            />
            <div>
              <strong>Ночная библиотека</strong>
              <span>Чистые страницы · 1 шт.</span>
            </div>
            <strong>1 690 ₽</strong>
          </div>
          <div className="summary-row">
            <span>В пункт выдачи</span>
            <span>350 ₽</span>
          </div>
          <div className="summary-total">
            <span>Итого в примере</span>
            <strong>2 040 ₽</strong>
          </div>
        </div>
        <Link
          className="button"
          href={key === 'success' ? '/catalog' : '/checkout'}
        >
          {key === 'success'
            ? 'Вернуться в мастерскую'
            : 'Вернуться к оформлению'}
          <Icon name="arrow" size={20} />
        </Link>
        <p className="stage-caption">
          Реальные статусы и повторная оплата
          <br />
          доступны после оформления в корзине.
        </p>
      </div>
    </div>
  );
}
