import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAccess } from '@/lib/auth/permissions';
import { listCompanyTickets } from '@/lib/support/tickets';
import { SupportScreen } from './support-screen';

export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const access = await getAccess();
  if (!access) redirect({ href: '/login', locale });
  return <SupportScreen initial={await listCompanyTickets(access!.companyId)} />;
}
