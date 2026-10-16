import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { adminAllowed } from '@/server/admin-session';
import { AdminLogin } from '@/components/admin-panel';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Вход в мастерскую',
  robots: { index: false, follow: false },
};
export default async function LoginPage() {
  if (await adminAllowed()) redirect('/admin');
  return <AdminLogin />;
}
