import Link from 'next/link';
import Image from 'next/image';
import { Carousel } from '@/components/carousel';
import { Icon } from '@/components/icons';
export default function Home() {
  return (
    <>
      <section className="hero container">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="little-line" />
            Мастерская маленьких чудес
          </p>
          <h1>
            Волшебство
            <br />в простых <em>вещах.</em>
          </h1>
          <p className="hero-description">
            Авторские блокноты, открытки и подарки,
            <br className="desktop-break" /> в которых живут любимые истории.
            <br className="desktop-break" /> Сделаны руками. Придуманы с
            любовью.
          </p>
          <Link className="button" href="/catalog">
            Заглянуть в каталог
            <Icon name="arrow" size={20} />
          </Link>
          <div className="hero-signature">
            <span className="signature">Ася</span>
            <span>
              и её небольшая
              <br />
              волшебная мастерская
            </span>
          </div>
        </div>
        <div className="hero-visual">
          <Image
            src="/images/hero.webp"
            alt="Бордовый блокнот с золотой луной, открытка с совой, письмо и латунная закладка на светлом столе"
            width={1536}
            height={1024}
            priority
            sizes="(max-width: 800px) 100vw, 60vw"
          />
          <span className="hero-stamp">
            <Icon name="star" size={28} />
            <span>
              РУЧНАЯ
              <br />
              РАБОТА
            </span>
          </span>
          <div className="photo-caption">
            <span>Бумага. Ткань. Немного магии.</span>
            <span>Коллекция № 01</span>
          </div>
        </div>
      </section>
      <div className="intro-strip container">
        <span>Вдохновлено историями, которые остаются с нами</span>
        <span aria-hidden="true">✦</span>
        <span>Создано для ваших собственных</span>
      </div>
      <Carousel />
      <section id="about" className="about-section">
        <div className="container about-grid">
          <div className="about-visual">
            <Image
              src="/images/workshop.webp"
              alt="Руки мастерицы сшивают страницы блокнота на столе с тканью, бумагой и переплётными инструментами"
              width={1200}
              height={900}
              sizes="(max-width: 800px) 100vw, 50vw"
            />
            <span className="photo-label">Там, где всё начинается</span>
          </div>
          <div className="about-copy">
            <p className="eyebrow">Привет, я Ася</p>
            <h2>
              Я всегда ждала
              <br />
              письмо <em>из Хогвартса.</em>
            </h2>
            <p>
              А пока оно было в пути — рисовала сов на полях тетрадей, собирала
              гербарии и придумывала свои маленькие чудеса.
            </p>
            <p>
              Теперь у меня есть мастерская. Здесь пахнет бумагой, тихо шуршат
              страницы и появляются вещи, которые хочется подарить — или
              оставить себе.
            </p>
            <p>
              Я рисую каждую иллюстрацию, сшиваю блокноты вручную и верю:
              немного волшебства есть в том, к чему приложили любовь.
            </p>
            <div className="about-signature">
              <span className="signature">С теплом, Ася</span>
              <Icon name="star" size={32} />
            </div>
          </div>
        </div>
      </section>
      <section className="craft-section container">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Не конвейер. Мастерская.</p>
            <h2>Забота в каждой детали</h2>
          </div>
          <p className="heading-note">
            От первого карандашного наброска
            <br />
            до последнего узелка на ленте.
          </p>
        </div>
        <div className="craft-grid">
          {[
            [
              '01',
              'Сделано руками',
              'Переплёт, роспись и сборка. У каждой вещи — свой характер и тепло настоящего материала.',
            ],
            [
              '02',
              'Маленькие серии',
              'Не тороплюсь и не делаю сотнями. Так остаётся время на каждую тонкую линию.',
            ],
            [
              '03',
              'Уже как подарок',
              'Тишью, коробка и хлопковая лента. Бережную упаковку не нужно добавлять отдельно.',
            ],
            [
              '04',
              'Понятные сроки',
              'Готовые вещи отправлю за 1–2 дня. Изделия на заказ сделаю за 3–5 рабочих дней.',
            ],
          ].map(([n, title, text]) => (
            <article key={n}>
              <span className="craft-number">{n}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="closing-section container">
        <span className="closing-star" aria-hidden="true">
          ✳
        </span>
        <p className="eyebrow">Для себя. Для кого-то особенного.</p>
        <h2>
          У каждой вещи
          <br />
          есть <em>свой человек.</em>
        </h2>
        <Link className="button" href="/catalog">
          Найти свою
          <Icon name="arrow" size={20} />
        </Link>
      </section>
    </>
  );
}
