/**
 * Service worker кабинета (раздел 6 ТЗ, этап 2): касса открывается без сети.
 *
 * - Статика Next (`/_next/static`) — из кэша: имена файлов содержат хэш и не меняются.
 * - Страница кассы — сначала сеть, без сети — последняя сохранённая копия. Товары и цены
 *   приходят в самой странице, чеки без сети копятся в очереди браузера и уходят
 *   на сервер по `clientId` без дублей, когда связь вернётся.
 * - Остальные страницы и API не кэшируются: в браузере не остаётся лишних данных компании.
 * При выходе из кабинета кнопка «Выйти» удаляет кэш страниц (`b2b-pages-v1`).
 */
const STATIC_CACHE = 'b2b-static-v1';
const PAGES_CACHE = 'b2b-pages-v1';
const OFFLINE_PAGES = /^\/(ru|kk)\/pos\/?$/;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== PAGES_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  if (request.mode === 'navigate' && OFFLINE_PAGES.test(url.pathname)) {
    event.respondWith(
      caches.open(PAGES_CACHE).then(async (cache) => {
        try {
          const response = await fetch(request);
          // Кэшируем только саму кассу, а не перенаправление на вход.
          if (response.ok && !response.redirected) cache.put(url.pathname, response.clone());
          return response;
        } catch (error) {
          const cached = await cache.match(url.pathname);
          if (cached) return cached;
          throw error;
        }
      }),
    );
  }
});
