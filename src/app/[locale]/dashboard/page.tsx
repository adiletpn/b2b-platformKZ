import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { Link } from '@/i18n/navigation';
import { buttonVariants } from '@/components/ui/button';
import { LogoutButton } from './logout-button';

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) redirect({ href: '/login', locale });

  const membership = session?.user.memberships[0];
  if (!membership) redirect({ href: '/onboarding', locale });

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: membership!.companyId },
    include: {
      locations: { include: { city: true } },
      deliveryZones: { include: { city: true } },
    },
  });

  const t = await getTranslations('dashboard');
  const tType = await getTranslations('companyType');
  const tStatus = await getTranslations('verificationStatus');
  const tOnboarding = await getTranslations('onboarding');
  const cityName = (city: { nameRu: string; nameKk: string }) =>
    locale === 'kk' ? city.nameKk : city.nameRu;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {company.type !== 'SUPPLIER' ? (
            <>
              <Link
                href="/feed"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid="go-feed"
              >
                {t('feedLink')}
              </Link>
              <Link
                href="/cart"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid="go-cart"
              >
                {t('cartLink')}
              </Link>
              <Link
                href="/stock"
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
                data-testid="go-stock"
              >
                {t('stockLink')}
              </Link>
            </>
          ) : null}
          {company.type !== 'STORE' ? (
            <Link
              href="/catalog"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
              data-testid="go-catalog"
            >
              {t('catalogLink')}
            </Link>
          ) : null}
          <Link
            href="/orders"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="go-orders"
          >
            {t('ordersLink')}
          </Link>
          <Link
            href="/requisites"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="go-requisites"
          >
            {t('requisitesLink')}
          </Link>
          <Link
            href="/employees"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            data-testid="go-employees"
          >
            {t('employeesLink')}
          </Link>
          <LogoutButton label={t('logout')} />
        </div>
      </header>

      <section
        className="border-border bg-card mt-6 rounded-lg border p-4"
        data-testid="company-card"
        data-company-id={company.id}
      >
        <h2 className="text-lg font-medium break-words" data-testid="company-name">
          {company.name}
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-muted-foreground">{t('bin')}</dt>
            <dd className="font-mono" data-testid="company-bin">
              {company.bin}
            </dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-muted-foreground">{t('type')}</dt>
            <dd data-testid="company-type">{tType(company.type)}</dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-muted-foreground">{t('verification')}</dt>
            <dd data-testid="company-status">{tStatus(company.verificationStatus)}</dd>
          </div>
          <div className="flex justify-between gap-3 sm:block">
            <dt className="text-muted-foreground">{t('vat')}</dt>
            <dd>{company.isVatPayer ? tOnboarding('vatYes') : tOnboarding('vatNo')}</dd>
          </div>
        </dl>
      </section>

      {company.locations.length > 0 ? (
        <section className="border-border bg-card mt-4 rounded-lg border p-4">
          <h2 className="text-muted-foreground text-sm font-medium">{t('locations')}</h2>
          <ul className="mt-2 space-y-1 text-sm" data-testid="company-locations">
            {company.locations.map((location) => (
              <li key={location.id} className="break-words">
                {cityName(location.city)}, {location.address}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {company.deliveryZones.length > 0 ? (
        <section className="border-border bg-card mt-4 rounded-lg border p-4">
          <h2 className="text-muted-foreground text-sm font-medium">{t('deliveryCities')}</h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm" data-testid="company-delivery-cities">
            {company.deliveryZones.map((zone) => (
              <li key={zone.id} className="bg-muted rounded-md px-2 py-1">
                {cityName(zone.city)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="mt-6 flex flex-wrap gap-2" data-testid="mockup-links">
        <Link
          href="/ratings"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          data-testid="go-ratings"
        >
          {t('ratingsLink')}
        </Link>
        <Link
          href="/chat"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          data-testid="go-chat"
        >
          {t('chatLink')}
        </Link>
        <Link
          href="/admin"
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          data-testid="go-admin"
        >
          {t('adminLink')}
        </Link>
      </nav>

      <p className="text-muted-foreground mt-6 text-sm">{t('nextStage')}</p>
    </main>
  );
}
