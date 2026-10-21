import { CookieNoticeButton } from './cookie-notice';
import Link from 'next/link';
import { Brand } from './header';
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-main">
          <div>
            <Brand footer />
            <p>
              Для тех, кто верит в истории
              <br />и замечает маленькие чудеса.
            </p>
          </div>
          <nav aria-label="Навигация в подвале">
            <Link href="/catalog">Все вещи мастерской</Link>
            <Link href="/delivery">Доставка и оплата</Link>
            <Link href="/#about">История Аси</Link>
          </nav>
          <div className="footer-note">
            <span className="eyebrow">Из мастерской с любовью</span>
            <p>
              Бумага, ткань и немного магии.
              <br />
              Каждая вещь — начало истории.
            </p>
            <span aria-hidden="true" className="footer-star">
              ✳
            </span>
          </div>
        </div>
        <nav className="footer-legal" aria-label="Документы мастерской">
          <Link href="/privacy">Политика обработки данных</Link>
          <Link href="/consent">Согласие на обработку</Link>
          <Link href="/offer">Оферта тестовой оплаты</Link>
          <Link href="/cookies">Cookie и данные браузера</Link>
          <CookieNoticeButton />
        </nav>
        <div className="footer-bottom">
          <span>© 2026 Письма и звёзды</span>
          <p>
            Вымышленная мастерская · портфолио-проект.
            <br className="mobile-break" /> Неофициальный проект по мотивам мира
            Гарри Поттера. Заказы не отправляются.
          </p>
          <Link href="/privacy">О данных</Link>
        </div>
      </div>
    </footer>
  );
}
