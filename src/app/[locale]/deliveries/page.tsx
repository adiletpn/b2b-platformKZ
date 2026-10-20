import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { listDeliveries } from '@/lib/deliveries/deliveries';
import { DeliveriesScreen } from './deliveries-screen';

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
  return (
    <DeliveriesScreen
      locale={locale === 'kk' ? 'kk' : 'ru'}
      title={t('title')}
      initial={await listDeliveries(access!.companyId)}
      canUpdate={await hasPermission(access!, 'DELIVERIES', 'UPDATE')}
    />
  );
}
