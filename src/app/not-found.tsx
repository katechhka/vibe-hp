import Link from 'next/link';
import { Icon } from '@/components/icons';
export default function NotFound() {
  return (
    <div className="container not-found">
      <span className="error-number">404</span>
      <p className="eyebrow">Кажется, письмо заблудилось</p>
      <h1>
        Этой страницы
        <br />
        нет в нашей истории.
      </h1>
      <p>
        Но на полках мастерской ещё много вещей,
        <br />с которых может начаться новая.
      </p>
      <Link className="button" href="/catalog">
        Вернуться в каталог
        <Icon name="arrow" />
      </Link>
    </div>
  );
}
