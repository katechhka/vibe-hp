import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminAllowed } from '@/server/admin-session';
import { AdminPanel } from '@/components/admin-panel';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Мастерская · управление',
  robots: { index: false, follow: false },
};
export default async function AdminPage() {
  if (!(await adminAllowed())) redirect('/admin/login');
  return <AdminPanel />;
}
