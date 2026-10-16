'use client';
import Image from 'next/image';
import { imageSrc } from '@/lib/product-image';
import Link from 'next/link';
import { useShop } from './shop-context';
import { money } from '@/data/catalog';
import { useCatalog } from './catalog-context';
import { Icon } from './icons';
import { cartSubtotal } from '@/lib/cart';
export function Cart() {
  const products = useCatalog();
  const { items, ready, update, count, storageWarning, getStock } = useShop();
  if (!ready)
    return (
      <div className="loading-note" role="status">
        Открываем корзину…
      </div>
    );
  if (!items.length)
    return (
      <div className="empty-state">
        <Icon name="bag" size={44} />
        {storageWarning && (
          <p role="status" className="stage-note">
            {storageWarning}
          </p>
        )}
        <h2>
          Здесь начинается
          <br />
          маленькая история
        </h2>
        <p>
          Пока в корзине пусто. На полках мастерской
          <br />
          точно найдётся что-то ваше.
        </p>
        <Link className="button" href="/catalog">
          Заглянуть в каталог
          <Icon name="arrow" />
        </Link>
      </div>
    );
  const total = cartSubtotal(items, products) / 100;
  return (
    <div className="cart-layout">
      <div>
        {storageWarning && (
          <p role="status" className="stage-note">
            {storageWarning}
          </p>
        )}
        <div className="cart-table-caption">
          <span>Ваши маленькие сокровища</span>
          <span>{count} шт.</span>
        </div>
        <div className="cart-lines">
          {items.map((line) => {
            const p = products.find((p) => p.id === line.id)!;
            const sumQuantity = items
              .filter((i) => i.id === p.id)
              .reduce((s, i) => s + i.quantity, 0);
            return (
              <article className="cart-line" key={line.id + line.variant}>
                <Link href={'/products/' + p.slug} className="cart-line-image">
                  <Image
                    src={imageSrc(p.image)}
                    alt={p.alt}
                    width={130}
                    height={160}
                  />
                </Link>
                <div className="cart-line-info">
                  <span className="eyebrow">{p.category}</span>
                  <Link href={'/products/' + p.slug}>
                    <h2>{p.name}</h2>
                  </Link>
                  {line.variant && <p>{line.variant}</p>}
                  <p>{money(p.price)} / шт.</p>
                  <button
                    className="plain-button remove-button"
                    onClick={() => update(line.id, line.variant, 0)}
                  >
                    Убрать из корзины
                  </button>
                </div>
                <div className="cart-line-end">
                  <strong>{money(p.price * line.quantity)}</strong>
                  <div className="quantity-control">
                    <button
                      aria-label={'Уменьшить количество: ' + p.name}
                      onClick={() =>
                        update(line.id, line.variant, line.quantity - 1)
                      }
                    >
                      <Icon name="minus" size={16} />
                    </button>
                    <output>{line.quantity}</output>
                    <button
                      aria-label={'Увеличить количество: ' + p.name}
                      disabled={sumQuantity >= getStock(p.id)}
                      onClick={() =>
                        update(line.id, line.variant, line.quantity + 1)
                      }
                    >
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <Link className="text-link continue-shopping" href="/catalog">
          <Icon name="left" size={18} />
          Продолжить выбирать
        </Link>
      </div>
      <aside className="order-summary">
        <p className="eyebrow">Почти у вас</p>
        <h2>Ваша история</h2>
        <div className="summary-row">
          <span>Вещи, {count} шт.</span>
          <span>{money(total)}</span>
        </div>
        <div className="summary-row">
          <span>Доставка</span>
          <span>от 350 ₽</span>
        </div>
        <p className="summary-help">
          Выберем способ и точную стоимость
          <br />
          на следующем шаге.
        </p>
        <div className="summary-total">
          <span>Товары</span>
          <strong>{money(total)}</strong>
        </div>
        <Link className="button" href="/checkout">
          К оформлению
          <Icon name="arrow" size={20} />
        </Link>
        <p className="summary-packaging">
          <Icon name="check" size={17} />
          Подарочная упаковка включена
        </p>
        <p className="stage-caption">
          Демонстрационный магазин.
          <br />
          Оплата без настоящих списаний.
        </p>
      </aside>
    </div>
  );
}
