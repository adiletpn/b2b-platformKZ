'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, type Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/** Переключатель языка сегментом, как в макете: «Қаз / Рус». */
export function LanguageSwitcher() {
  const t = useTranslations('locale');
  const current = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav aria-label={t('label')} className="bg-muted flex rounded-full p-[3px]">
      {locales.map((locale: Locale) => (
        <button
          key={locale}
          type="button"
          title={t(locale)}
          aria-current={locale === current ? 'true' : undefined}
          data-testid={`locale-${locale}`}
          onClick={() => router.replace(pathname, { locale })}
          className={cn(
            'h-8 rounded-full px-3.5 text-[13px] font-bold whitespace-nowrap transition-colors',
            locale === current
              ? 'bg-card text-foreground shadow-[0_1px_4px_rgb(0_0_0/0.08)]'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(`short.${locale}`)}
        </button>
      ))}
    </nav>
  );
}
