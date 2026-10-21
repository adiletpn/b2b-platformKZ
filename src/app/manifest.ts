import type { MetadataRoute } from 'next';
import { getTranslations } from 'next-intl/server';

/**
 * PWA (раздел 6 ТЗ, этап 2): кабинет ставится на телефон и планшет как приложение,
 * касса открывается без сети. Иконки — плейсхолдер, фирменный стиль не передан (TZ-demo 8.6).
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations({ locale: 'ru', namespace: 'app' });
  const tNav = await getTranslations({ locale: 'ru', namespace: 'dashboard' });
  return {
    name: t('name'),
    short_name: t('name'),
    description: t('tagline'),
    lang: 'ru',
    start_url: '/ru/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#f5820c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [{ name: tNav('posLink'), url: '/ru/pos' }],
  };
}
