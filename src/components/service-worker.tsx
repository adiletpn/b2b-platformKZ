'use client';

import { useEffect } from 'react';

/**
 * Регистрирует service worker (`public/sw.js`) только в сборке для показа и боевой:
 * в режиме разработки кэш мешал бы видеть свежий код.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
  }, []);
  return null;
}
