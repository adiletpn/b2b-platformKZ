import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Onest } from 'next/font/google';
import { routing } from '@/i18n/routing';
import { AppShell } from '@/components/app-header';
import { ServiceWorkerRegistration } from '@/components/service-worker';
import { HydrationMark } from '@/components/hydration-mark';
import '../globals.css';

// Шапка читает сессию из cookie: макет не должен попадать в статическую сборку,
// иначе навигация и выход пропадают.
export const dynamic = 'force-dynamic';

export const viewport: Viewport = { themeColor: '#f5820c' };

// Шрифт макета — Onest: кириллица с казахскими буквами, грузится при сборке, без внешних запросов.
const onest = Onest({
  subsets: ['latin', 'cyrillic', 'cyrillic-ext'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-onest',
  display: 'swap',
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'app' });
  return { title: t('name'), description: t('tagline') };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} className={onest.variable}>
      <body>
        <NextIntlClientProvider>
          {/* Шапка общая: разделы, язык и выход доступны с любого экрана. */}
          <AppShell>{children}</AppShell>
          <ServiceWorkerRegistration />
          <HydrationMark />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
