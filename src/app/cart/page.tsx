import type { Metadata } from 'next';
import { Cart } from '@/components/cart';
export const metadata: Metadata = {
  title: 'Корзина',
  robots: { index: false, follow: false },
};
export default function CartPage() {
  return (
    <div className="container page-space">
      <div className="page-heading compact-heading">
        <p className="eyebrow">Вы выбрали</p>
        <h1>Ваша корзина</h1>
      </div>
      <Cart />
    </div>
  );
}
