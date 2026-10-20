import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  AlertTriangle,
  Boxes,
  Calculator,
  ClipboardList,
  Package,
  PackageCheck,
  ShoppingBasket,
  Truck,
  Wallet,
} from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle, StatCard } from '@/components/ui/card';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { getOnboardingProgress } from '@/lib/registration/onboarding';
import { getDashboardSummary } from '@/lib/dashboard/summary';
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

  const [progress, summary] = await Promise.all([
    getOnboardingProgress(company.id),
    getDashboardSummary(company.id),
  ]);

  const t = await getTranslations('dashboard');
  const tHome = await getTranslations('dashboard.home');
  const tType = await getTranslations('companyType');
  const tStatus = await getTranslations('verificationStatus');
  const tOnboarding = await getTranslations('onboarding');
  const cityName = (city: { nameRu: string; nameKk: string }) =>
    locale === 'kk' ? city.nameKk : city.nameRu;

  const verified = company.verificationStatus === 'VERIFIED';
  const store = company.type !== 'SUPPLIER';
  const supplier = company.type !== 'STORE';

  return (
    <Page width="lg">
      <PageHeader
        title={tHome('greeting')}
        description={company.name}
        actions={
          <>
            {store ? (
              <Link href="/feed" className={buttonVariants()} data-testid="quick-feed">
                <ShoppingBasket aria-hidden />
                {tHome('actions.feed')}
              </Link>
            ) : null}
            {supplier ? (
              <Link
                href="/catalog"
                className={buttonVariants({ variant: store ? 'outline' : 'default' })}
              >
                <Package aria-hidden />
                {tHome('actions.catalog')}
              </Link>
            ) : null}
            {store ? (
              <Link href="/pos" className={buttonVariants({ variant: 'outline' })}>
                <Calculator aria-hidden />
                {tHome('actions.pos')}
              </Link>
            ) : null}
          </>
        }
      />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="dashboard-stats">
        <StatCard
          icon={ClipboardList}
          label={tHome('stats.inProgress')}
          value={summary.ordersInProgress}
          hint={supplier ? tHome('stats.newOrders', { count: summary.newOrders }) : undefined}
        />
        <StatCard
          icon={Wallet}
          tone={summary.overdueCount > 0 ? 'danger' : 'warning'}
          label={supplier && !store ? tHome('stats.receivables') : tHome('stats.toPay')}
          value={`${summary.unpaidTotal} ₸`}
          hint={
            summary.overdueCount > 0
              ? tHome('stats.overdue', { count: summary.overdueCount })
              : undefined
          }
        />
        {store ? (
          <StatCard
            icon={Calculator}
            tone="success"
            label={tHome('stats.salesToday')}
            value={`${summary.salesToday} ₸`}
            hint={tHome('stats.receipts', { count: summary.receiptsToday })}
          />
        ) : (
          <StatCard
            icon={Truck}
            tone="success"
            label={tHome('stats.toShip')}
            value={summary.toShip}
          />
        )}
        {store ? (
          <StatCard
            icon={summary.lowStock > 0 ? AlertTriangle : Boxes}
            tone={summary.lowStock > 0 ? 'accent' : 'neutral'}
            label={tHome('stats.lowStock')}
            value={summary.lowStock}
          />
        ) : (
          <StatCard
            icon={PackageCheck}
            tone="neutral"
            label={tHome('stats.offers')}
            value={summary.activeOffers}
          />
        )}
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className="p-0">
            <div className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-5">
              <CardTitle>{tHome('recentOrders')}</CardTitle>
              <Link href="/orders" className="text-primary text-sm hover:underline">
                {tHome('allOrders')}
              </Link>
            </div>
            {summary.recentOrders.length === 0 ? (
              <div className="p-4 sm:p-5">
                <EmptyState>{tHome('noOrders')}</EmptyState>
              </div>
            ) : (
              <ul className="divide-border mt-2 divide-y" data-testid="dashboard-orders">
                {summary.recentOrders.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/orders/${order.id}`}
                      className="hover:bg-muted/50 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:flex sm:px-5"
                    >
                      <span className="font-mono text-xs sm:w-36">{order.number}</span>
                      <span className="justify-self-end sm:order-3">
                        <OrderStatusBadge status={order.status} />
                      </span>
                      <span className="min-w-0 truncate text-sm sm:order-2 sm:flex-1">
                        {order.counterparty}
                      </span>
                      <span className="text-right text-sm font-medium tabular-nums sm:order-4 sm:w-28">
                        {order.total} ₸
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <OnboardingWizard progress={progress} />
        </div>

        <div className="space-y-4">
          <Card data-testid="company-card" data-company-id={company.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle className="min-w-0 break-words" data-testid="company-name">
                {company.name}
              </CardTitle>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone="info" data-testid="company-type">
                {tType(company.type)}
              </Badge>
              <Badge tone={verified ? 'success' : 'warning'} data-testid="company-status">
                {tStatus(company.verificationStatus)}
              </Badge>
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('bin')}</dt>
                <dd className="font-mono" data-testid="company-bin">
                  {company.bin}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('vat')}</dt>
                <dd>{company.isVatPayer ? tOnboarding('vatYes') : tOnboarding('vatNo')}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{t('requisitesLink')}</dt>
                <dd className="min-w-0 truncate font-mono">{company.iik ?? t('empty')}</dd>
              </div>
            </dl>
          </Card>

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
      </div>
    </Page>
  );
}
