import type { Metadata } from 'next';
import { Header } from '@/components/header';
import { Footer } from '@/components/footer';
import { ShopProvider } from '@/components/shop-context';
import { appStore as getStore } from '@/server/app-store';
import { CatalogProvider } from '@/components/catalog-context';
import './globals.css';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || 'http://127.0.0.1:3000'),
  title: {
    default: 'Письма и звёзды — авторская мастерская',
    template: '%s · Письма и звёзды',
  },
  description:
    'Блокноты ручного переплёта, открытки и маленькие подарки по мотивам волшебных историй. Вымышленная мастерская Аси Мироновой.',
  openGraph: {
    title: 'Письма и звёзды',
    description: 'Немного волшебства, сделанного руками.',
    locale: 'ru_RU',
    type: 'website',
    images: [
      {
        url: '/images/hero.webp',
        width: 1536,
        height: 1024,
        alt: 'Блокнот, письмо и маленькие сокровища мастерской',
      },
    ],
  },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <head>
        <link rel="stylesheet" href="/fonts/fonts.css" />
      </head>
      <body>
        <CatalogProvider products={await getStore().catalog()}>
          <ShopProvider>
            <a className="skip-link" href="#main">
              К содержимому
            </a>
            <Header />
            <main id="main">{children}</main>
            <Footer />
          </ShopProvider>
        </CatalogProvider>
      </body>
    </html>
  );
}
