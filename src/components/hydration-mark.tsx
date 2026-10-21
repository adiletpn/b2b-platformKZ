'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/** Отметка «страница ожила» для автотестов: после прямого перехода ждут её, а не сеть. */
export function HydrationMark({ name = 'hydrated' }: { name?: 'hydrated' | 'pageHydrated' }) {
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.dataset[name] = pathname;
  }, [name, pathname]);
  return null;
}
