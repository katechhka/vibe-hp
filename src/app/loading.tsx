export default function Loading() {
  return (
    <div className="container loading-screen" role="status">
      <span className="loading-star" aria-hidden="true">
        ✳
      </span>
      <p>Открываем новую страницу истории…</p>
    </div>
  );
}
