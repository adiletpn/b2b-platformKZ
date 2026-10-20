import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  Calculator,
  FileSignature,
  FileSpreadsheet,
  Handshake,
  MapPin,
  ShieldCheck,
  ShoppingBasket,
  Smartphone,
  Truck,
  WifiOff,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';
import { IconBadge } from '@/components/ui/card';

const STEPS = ['catalog', 'swipe', 'cart', 'confirm', 'accept', 'pay', 'sell'] as const;

const FEATURES = [
  { key: 'swipe', icon: ShoppingBasket },
  { key: 'documents', icon: FileSignature },
  { key: 'stock', icon: Boxes },
  { key: 'pos', icon: Calculator },
  { key: 'delivery', icon: Truck },
  { key: 'exports', icon: FileSpreadsheet },
] as const;

const TRUST = [
  { key: 'bin', icon: BadgeCheck },
  { key: 'ecp', icon: ShieldCheck },
  { key: 'offline', icon: WifiOff },
  { key: 'mobile', icon: Smartphone },
  { key: 'cities', icon: MapPin },
] as const;

/** Главная: что это за сервис, кому он нужен и как устроен путь заказа (раздел 1 ТЗ). */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  return (
    <main className="bg-hero">
      <section
        className="animate-rise mx-auto w-full max-w-6xl px-4 pt-12 pb-14 sm:px-6 lg:pt-20 lg:pb-20"
        data-testid="landing-hero"
      >
        <p className="border-border bg-card/70 text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs backdrop-blur">
          <Handshake aria-hidden className="text-primary size-3.5" />
          {t('eyebrow')}
        </p>
        <h1 className="mt-5 max-w-3xl text-3xl leading-tight font-semibold tracking-tight break-words sm:text-5xl">
          {t('title')}
        </h1>
        <p className="text-muted-foreground mt-5 max-w-2xl text-base sm:text-lg">{t('subtitle')}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login" className={buttonVariants({ size: 'lg' })} data-testid="go-login">
            {t('enter')}
            <ArrowRight aria-hidden />
          </Link>
          <a href="#how" className={buttonVariants({ size: 'lg', variant: 'outline' })}>
            {t('how')}
          </a>
        </div>
        <p className="text-muted-foreground mt-4 text-xs">{t('demoNote')}</p>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ key, icon }) => (
            <article
              key={key}
              className="border-border bg-card shadow-card hover:shadow-lift rounded-xl border p-5 transition-shadow"
              data-testid={`feature-${key}`}
            >
              <IconBadge icon={icon} />
              <h2 className="mt-4 font-semibold">{t(`features.${key}.title`)}</h2>
              <p className="text-muted-foreground mt-1.5 text-sm">{t(`features.${key}.text`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="how" className="border-border bg-card/60 border-y">
        <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">{t('stepsTitle')}</h2>
          <p className="text-muted-foreground mt-2 max-w-2xl">{t('stepsSubtitle')}</p>
          <ol className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((key, index) => (
              <li key={key} className="relative">
                <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-full text-sm font-semibold">
                  {index + 1}
                </span>
                <p className="mt-3 font-medium">{t(`steps.${key}.title`)}</p>
                <p className="text-muted-foreground mt-1 text-sm">{t(`steps.${key}.text`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t('forStoresTitle')}</h2>
            <ul className="text-muted-foreground mt-4 space-y-2 text-sm">
              {(['1', '2', '3', '4'] as const).map((key) => (
                <li key={key} className="flex gap-2">
                  <BadgeCheck aria-hidden className="text-success mt-0.5 size-4 shrink-0" />
                  {t(`forStores.${key}`)}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">{t('forSuppliersTitle')}</h2>
            <ul className="text-muted-foreground mt-4 space-y-2 text-sm">
              {(['1', '2', '3', '4'] as const).map((key) => (
                <li key={key} className="flex gap-2">
                  <BadgeCheck aria-hidden className="text-success mt-0.5 size-4 shrink-0" />
                  {t(`forSuppliers.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <ul className="mt-12 flex flex-wrap gap-2">
          {TRUST.map(({ key, icon: Icon }) => (
            <li
              key={key}
              className="border-border bg-card text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs"
            >
              <Icon aria-hidden className="text-primary size-3.5" />
              {t(`trust.${key}`)}
            </li>
          ))}
        </ul>

        <div className="from-primary mt-12 rounded-2xl bg-gradient-to-br to-[oklch(0.42_0.12_245)] p-6 text-white shadow-lg sm:p-10">
          <h2 className="text-2xl font-semibold">{t('ctaTitle')}</h2>
          <p className="mt-2 max-w-xl text-white/80">{t('ctaText')}</p>
          <Link
            href="/login"
            className={`${buttonVariants({ size: 'lg', variant: 'accent' })} mt-6`}
          >
            {t('enter')}
            <ArrowRight aria-hidden />
          </Link>
        </div>
      </section>

      <footer className="border-border text-muted-foreground border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap justify-between gap-2 px-4 py-6 text-xs sm:px-6">
          <span>{t('footer')}</span>
          <span>{t('footerData')}</span>
        </div>
      </footer>
    </main>
  );
}
