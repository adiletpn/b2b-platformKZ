import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import { AppHeader } from '@/components/app-header';
import { ServiceWorkerRegistration } from '@/components/service-worker';
import '../globals.css';

// Шапка читает сессию из cookie: макет не должен попадать в статическую сборку,
// иначе навигация и выход пропадают.
export const dynamic = 'force-dynamic';

export const viewport: Viewport = { themeColor: '#1f6f9f' };

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
    <html lang={locale}>
      <body>
        <NextIntlClientProvider>
          {/* Шапка общая: разделы, язык и выход доступны с любого экрана. */}
          <AppHeader />
          <ServiceWorkerRegistration />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
