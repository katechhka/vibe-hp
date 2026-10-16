'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icon } from './icons';
import { useShop } from './shop-context';
const links = [
  ['/', 'Главная'],
  ['/catalog', 'Каталог'],
  ['/delivery', 'Доставка и оплата'],
];
export function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <Link
      className={'brand' + (footer ? ' brand--footer' : '')}
      href="/"
      aria-label="Письма и звёзды — главная"
    >
      <span className="brand-symbol" aria-hidden="true">
        ✳
      </span>
      <span>
        письма <i>и</i> звёзды<small>АВТОРСКАЯ МАСТЕРСКАЯ</small>
      </span>
    </Link>
  );
}
export function Header() {
  const path = usePathname();
  const { count } = useShop();
  const dialog = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dialog.current?.close();
  }, [path]);
  const close = () => dialog.current?.close();
  return (
    <>
      <div className="announcement">
        Маленькие вещи для больших историй <span aria-hidden="true">✦</span>{' '}
        Сделано вручную, с теплом
      </div>
      <header className="site-header">
        <div className="container header-inner">
          <Brand />
          <nav className="desktop-nav" aria-label="Основная навигация">
            {links.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={path === href ? 'page' : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <Link
              href="/cart"
              className="cart-link"
              aria-label={'Корзина, товаров: ' + count}
            >
              <Icon name="bag" />
              <span className="cart-label">Корзина</span>
              <span className="cart-count">{count}</span>
            </Link>
            <button
              ref={menuButton}
              className="icon-button menu-trigger"
              aria-label="Открыть меню"
              onClick={() => dialog.current?.showModal()}
            >
              <Icon name="menu" />
            </button>
          </div>
        </div>
      </header>
      <dialog
        ref={dialog}
        className="mobile-menu"
        aria-label="Меню мастерской"
        onClose={() => menuButton.current?.focus()}
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <div className="mobile-menu__top">
          <span className="eyebrow">Мастерская</span>
          <button
            className="icon-button"
            onClick={close}
            aria-label="Закрыть меню"
          >
            <Icon name="close" />
          </button>
        </div>
        <nav aria-label="Мобильная навигация">
          {links.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              onClick={close}
              aria-current={path === href ? 'page' : undefined}
            >
              {label}
              <Icon name="arrow" />
            </Link>
          ))}
        </nav>
        <p>
          Немного волшебства,
          <br />
          сделанного руками.
        </p>
      </dialog>
    </>
  );
}
