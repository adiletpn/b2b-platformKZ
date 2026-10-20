'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { locales, type Locale } from '@/i18n/routing';
import { Button } from '@/components/ui/button';

/** `inShell` — кнопки внутри оболочки: на компьютере она тёмная, нужны светлые рамки. */
export const SHELL_OUTLINE =
  'lg:border-white/15 lg:bg-transparent lg:text-sidebar-foreground lg:hover:bg-white/10';

export function LanguageSwitcher({ inShell = false }: { inShell?: boolean }) {
  const t = useTranslations('locale');
  const current = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  return (
    <nav aria-label={t('label')} className="flex gap-1">
      {locales.map((locale: Locale) => (
        <Button
          key={locale}
          size="sm"
          variant={locale === current ? 'default' : 'outline'}
          className={inShell && locale !== current ? SHELL_OUTLINE : undefined}
          aria-current={locale === current ? 'true' : undefined}
          data-testid={`locale-${locale}`}
          onClick={() => router.replace(pathname, { locale })}
        >
          {t(locale)}
        </Button>
      ))}
    </nav>
  );
}
