import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { listDeliveries } from '@/lib/deliveries/deliveries';
import { DeliveriesScreen } from './deliveries-screen';
import { RoutesPanel } from './routes-panel';
import { availableOrders, listDrivers, listRoutes } from '@/lib/deliveries/routes';
import { kzDayKey } from '@/lib/format';

export default async function DeliveriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await getAccess();
  if (!access) redirect({ href: '/login', locale });
  // Раздел 1.2 ТЗ: список доставок — у водителя и тех, кому дано право DELIVERIES.
  if (!(await hasPermission(access!, 'DELIVERIES', 'VIEW'))) {
    redirect({ href: '/dashboard', locale });
  }

  const t = await getTranslations('deliveries');
  const companyId = access!.companyId;
  // Этап 3 ТЗ: рейсы собирает тот, у кого есть право создавать доставки.
  const canPlan = await hasPermission(access!, 'DELIVERIES', 'CREATE');
  const [orders, drivers, routes, myRoutes] = await Promise.all([
    canPlan ? availableOrders(companyId) : [],
    canPlan ? listDrivers(companyId) : [],
    canPlan ? listRoutes(companyId) : [],
    listRoutes(companyId, { driverMembershipId: access!.membershipId }),
  ]);
  return (
    <DeliveriesScreen
      locale={locale === 'kk' ? 'kk' : 'ru'}
      title={t('title')}
      initial={await listDeliveries(companyId)}
      canUpdate={await hasPermission(access!, 'DELIVERIES', 'UPDATE')}
    >
      <RoutesPanel
        locale={locale === 'kk' ? 'kk' : 'ru'}
        today={kzDayKey(new Date())}
        canPlan={canPlan}
        orders={orders}
        drivers={drivers}
        routes={routes}
        myRoutes={myRoutes}
      />
    </DeliveriesScreen>
  );
}
