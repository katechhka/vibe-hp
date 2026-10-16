import type { Metadata } from 'next';
import { Checkout } from '@/components/checkout';
import Link from 'next/link';
export const metadata: Metadata = {
  title: 'Оформление',
  robots: { index: false, follow: false },
};
export default function CheckoutPage() {
  return (
    <div className="container page-space">
      <nav className="checkout-steps" aria-label="Шаги покупки">
        <Link href="/cart">Корзина</Link>
        <span aria-hidden="true">→</span>
        <span aria-current="step">Оформление</span>
        <span aria-hidden="true">→</span>
        <span>Тестовая оплата</span>
      </nav>
      <div className="page-heading compact-heading">
        <p className="eyebrow">Последние штрихи</p>
        <h1>Всё почти готово</h1>
      </div>
      <Checkout />
    </div>
  );
}
