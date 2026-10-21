import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  AlertTriangle,
  Boxes,
  Calculator,
  ClipboardList,
  Package,
  PackageCheck,
  ShieldCheck,
  ShoppingBasket,
  Truck,
  Wallet,
} from 'lucide-react';
import { Link, redirect } from '@/i18n/navigation';
import { getActiveCompany } from '@/lib/auth/active-company';
import { prisma } from '@/lib/prisma';
import { Badge } from '@/components/ui/badge';
import { NotYetBadge } from '@/components/ui/not-yet';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle, StatCard } from '@/components/ui/card';
import { EmptyState, Page, PageHeader } from '@/components/ui/page';
import { OrderStatusBadge } from '@/components/order-status-badge';
import { getOnboardingProgress } from '@/lib/registration/onboarding';
import { getDashboardSummary } from '@/lib/dashboard/summary';
import { OnboardingWizard } from './onboarding-progress';
import { activeBannersFor } from '@/lib/admin/banners';
import { CabinetBanners } from '@/components/cabinet-banners';
import { navGroups } from '@/components/app-header';
import { NavLinks } from '@/components/nav-links';
import { money } from '@/lib/format';
import { Avatar } from '@/components/ui/controls';

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

  const [progress, summary, banners] = await Promise.all([
    getOnboardingProgress(company.id),
    getDashboardSummary(company.id),
    activeBannersFor(company.type),
  ]);

  const t = await getTranslations('dashboard');
  const tHome = await getTranslations('dashboard.home');
  const tType = await getTranslations('companyType');
  const tStatus = await getTranslations('verificationStatus');
  const tSoon = await getTranslations('common.notYetItems');
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

      <CabinetBanners
        banners={banners.map((banner) => ({
          id: banner.id,
          text: locale === 'kk' ? banner.textKk : banner.textRu,
        }))}
      />

      {/* Макет M13: на телефоне сначала компания и заполненность профиля, затем сводка,
          заявки и разделы. На компьютере компания и профиль — правой колонкой. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-flow-dense lg:grid-cols-3">
        <section
          className="border-border bg-card rounded-[22px] border p-[18px] lg:col-start-3 lg:self-start"
          data-testid="company-card"
          data-company-id={company.id}
        >
          <div className="flex items-center gap-3.5">
            <Avatar name={company.name} size={52} letters={1} />
            <div className="min-w-0">
              <h2 className="text-[17px] font-black break-words" data-testid="company-name">
                {company.name}
              </h2>
              <p className="text-muted-foreground mt-0.5 text-[13px] font-semibold">
                <span data-testid="company-type">{tType(company.type)}</span>
                {' · '}
                {tHome('companyPoints', { count: company.locations.length })}
                {' · '}
                {t('bin')} <span data-testid="company-bin">{company.bin}</span>
              </p>
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <Badge tone={verified ? 'success' : 'warning'} data-testid="company-status">
              <ShieldCheck aria-hidden className="size-3.5" />
              {tStatus(company.verificationStatus)}
            </Badge>
            <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs font-semibold">
              {tSoon('ecpVerified')}
              <NotYetBadge />
            </span>
          </div>
        </section>

        <div className="lg:col-start-3">
          <OnboardingWizard progress={progress} />
        </div>

        <section
          className="grid grid-cols-2 gap-3 lg:col-span-2 lg:col-start-1 lg:row-start-1 2xl:grid-cols-4"
          data-testid="dashboard-stats"
        >
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
            value={`${money(summary.unpaidTotal)} ₸`}
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
              value={`${money(summary.salesToday)} ₸`}
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

        <Card className="p-0 lg:col-span-2 lg:col-start-1 lg:row-span-3 lg:self-start">
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
                    <span className="text-[13px] font-extrabold sm:w-40">{order.number}</span>
                    <span className="justify-self-end sm:order-3">
                      <OrderStatusBadge status={order.status} />
                    </span>
                    <span className="min-w-0 truncate text-sm sm:order-2 sm:flex-1">
                      {order.counterparty}
                    </span>
                    <span className="text-right text-sm font-extrabold tabular-nums sm:order-4 sm:w-28">
                      {money(order.total)} ₸
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {company.locations.length > 0 ? (
          <Card className="lg:col-start-3">
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
          <Card className="lg:col-start-3">
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

      {/* На телефоне разделы — списком внизу кабинета, как в макете M13. */}
      <div className="mt-4">
        <NavLinks groups={await navGroups(company.type)} variant="menu" />
      </div>
    </Page>
  );
}
