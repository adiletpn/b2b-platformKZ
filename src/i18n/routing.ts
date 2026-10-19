import { defineRouting } from 'next-intl/routing';

export const locales = ['ru', 'kk'] as const;
export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: 'ru',
  localePrefix: 'always',
});
