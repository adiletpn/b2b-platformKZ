import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';

const cardKeys = ['registration', 'catalog', 'swipe', 'orders', 'documents', 'acceptance'] as const;

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');
  const tApp = await getTranslations('app');
  const tCommon = await getTranslations('common');

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-muted-foreground text-sm">{tApp('name')}</p>
          <h1 className="mt-1 text-2xl font-semibold break-words sm:text-3xl">{t('title')}</h1>
        </div>
        <Link href="/login" className={buttonVariants({ size: 'sm' })} data-testid="go-login">
          {t('enter')}
        </Link>
      </header>

      <p className="text-muted-foreground mt-4">{t('subtitle')}</p>

      <div className="border-border bg-card mt-6 inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <span className="text-muted-foreground">{t('stageLabel')}</span>
        <span className="font-medium" data-testid="current-stage">
          {t('stageValue')}
        </span>
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-medium">{t('cardsTitle')}</h2>
        <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cardKeys.map((key) => (
            <li
              key={key}
              className="border-border bg-card rounded-lg border p-4 text-sm"
              data-testid={`demo-card-${key}`}
            >
              <p className="font-medium break-words">{t(`cards.${key}`)}</p>
              <p className="text-muted-foreground mt-2 text-xs">{tCommon('comingSoon')}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
