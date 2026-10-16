import { appStore as getStore } from '@/server/app-store';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { owner } from '@/server/http';
import { ShopError } from '@/server/store';
import { OrderStatus } from '@/components/order-status';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Ваш заказ',
  robots: { index: false, follow: false },
};
export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    return (
      <OrderStatus
        initial={await getStore().get((await params).id, await owner())}
      />
    );
  } catch (e) {
    if (e instanceof ShopError && e.status === 404) notFound();
    throw e;
  }
}
