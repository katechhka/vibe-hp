'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="container empty-state">
      <p className="eyebrow">Страница не открылась</p>
      <h2>Попробуем ещё раз?</h2>
      <p>Кажется, произошла техническая ошибка.</p>
      <button className="button" onClick={reset}>
        Повторить загрузку →
      </button>
    </div>
  );
}
