import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Page, PageHeader } from '@/components/ui/page';
import { getOnboardingProgress } from '@/lib/registration/onboarding';
import { OnboardingWizard } from './onboarding-progress';

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const active = await getActiveCompany();
  if (!active) redirect({ href: '/login', locale });

  const company = await prisma.company.findUniqueOrThrow({
    where: { id: active!.companyId },
    include: {
      locations: { include: { city: true } },
      deliveryZones: { include: { city: true } },
    },
  });

  const progress = await getOnboardingProgress(company.id);

  const t = await getTranslations('dashboard');
  const tType = await getTranslations('companyType');
  const tStatus = await getTranslations('verificationStatus');
  const tOnboarding = await getTranslations('onboarding');
  const cityName = (city: { nameRu: string; nameKk: string }) =>
    locale === 'kk' ? city.nameKk : city.nameRu;

  const verified = company.verificationStatus === 'VERIFIED';

  return (
    <Page>
      <PageHeader title={t('title')} description={company.name} />

      <Card data-testid="company-card" data-company-id={company.id}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="min-w-0 break-words" data-testid="company-name">
            {company.name}
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge tone="info" data-testid="company-type">
              {tType(company.type)}
            </Badge>
            <Badge tone={verified ? 'success' : 'warning'} data-testid="company-status">
              {tStatus(company.verificationStatus)}
            </Badge>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-xs">{t('bin')}</dt>
            <dd className="mt-0.5 font-mono" data-testid="company-bin">
              {company.bin}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t('vat')}</dt>
            <dd className="mt-0.5">
              {company.isVatPayer ? tOnboarding('vatYes') : tOnboarding('vatNo')}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">{t('requisitesLink')}</dt>
            <dd className="mt-0.5 font-mono break-all">{company.iik ?? t('empty')}</dd>
          </div>
        </dl>
      </Card>

      <OnboardingWizard progress={progress} />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {company.locations.length > 0 ? (
          <Card>
            <CardTitle className="text-sm">{t('locations')}</CardTitle>
            <ul className="mt-2 space-y-1 text-sm" data-testid="company-locations">
              {company.locations.map((location) => (
                <li key={location.id} className="break-words">
                  {cityName(location.city)}, {location.address}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        {company.deliveryZones.length > 0 ? (
          <Card>
            <CardTitle className="text-sm">{t('deliveryCities')}</CardTitle>
            <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="company-delivery-cities">
              {company.deliveryZones.map((zone) => (
                <li key={zone.id}>
                  <Badge>{cityName(zone.city)}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>

      <nav className="mt-6 flex flex-wrap gap-2" data-testid="extra-links">
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
    </Page>
  );
}
