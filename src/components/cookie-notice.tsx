'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
const key = 'ps-cookie-notice-v1';
const revision = '2026-10-21';
const reopen = 'ps:show-cookie-notice';
export function CookieNoticeButton() {
  return (
    <button
      type="button"
      className="plain-button"
      onClick={() => window.dispatchEvent(new Event(reopen))}
    >
      Настройки cookie
    </button>
  );
}
export function CookieNotice() {
  const [visible, setVisible] = useState(false);
  const wasReopened = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    try {
      setVisible(localStorage.getItem(key) !== revision);
    } catch {
      setVisible(true);
    }
    const show = () => {
      returnFocus.current = document.activeElement as HTMLElement;
      wasReopened.current = true;
      setVisible(true);
    };
    const sync = (event: StorageEvent) => {
      if (event.key === key) setVisible(event.newValue !== revision);
    };
    window.addEventListener(reopen, show);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(reopen, show);
      window.removeEventListener('storage', sync);
    };
  }, []);
  useEffect(() => {
    if (visible && wasReopened.current) heading.current?.focus();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const notice = document.querySelector<HTMLElement>('.cookie-notice');
    if (!notice) return;
    const update = () =>
      document.documentElement.style.setProperty(
        '--cookie-notice-space',
        notice.getBoundingClientRect().height + 48 + 'px'
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(notice);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--cookie-notice-space');
    };
  }, [visible]);
  function acknowledge() {
    try {
      localStorage.setItem(key, revision);
    } catch {
      /* Still allow dismissing for this visit. */
    }
    setVisible(false);
    if (wasReopened.current) {
      returnFocus.current?.focus();
      wasReopened.current = false;
    }
  }
  if (!visible) return null;
  return (
    <aside
      className="cookie-notice"
      role="region"
      aria-labelledby="cookie-notice-title"
    >
      <span className="cookie-star" aria-hidden="true">
        ✳
      </span>
      <div>
        <h2 ref={heading} tabIndex={-1} id="cookie-notice-title">
          Пусть корзина помнит ваши находки
        </h2>
        <p>
          Используем технические cookie и хранилище браузера для корзины,
          черновика и доступа к заказу. Без рекламных трекеров.{' '}
          <Link href="/cookies">Как это работает</Link>
        </p>
      </div>
      <button type="button" className="button" onClick={acknowledge}>
        Понятно
      </button>
    </aside>
  );
}
