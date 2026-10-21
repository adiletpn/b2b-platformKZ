/**
 * Мгновенный отклик при переходе между разделами: скелет в форме карточек макета,
 * пока сервер готовит страницу.
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8" aria-busy="true">
      <div className="bg-muted h-8 w-48 animate-pulse rounded-full" />
      <div className="bg-muted mt-3 h-4 w-72 animate-pulse rounded-full" />
      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="border-border bg-card h-24 animate-pulse rounded-[20px] border"
          />
        ))}
      </div>
      <div className="border-border bg-card mt-4 h-72 animate-pulse rounded-[20px] border" />
    </main>
  );
}
