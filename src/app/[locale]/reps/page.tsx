import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { eligibleStores, listAssignments, listReps, repStores } from '@/lib/reps/reps';
import { RepsScreen } from './reps-screen';

export default async function RepsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await getAccess();
  if (!access) redirect({ href: '/login', locale });
  if (!(await hasPermission(access!, 'SALES_REPS', 'VIEW'))) {
    redirect({ href: '/dashboard', locale });
  }
  const { companyId, membershipId } = access!;
  const manage = await hasPermission(access!, 'SALES_REPS', 'UPDATE');
  const [stores, reps, customers, assignments] = await Promise.all([
    repStores(companyId, membershipId),
    manage ? listReps(companyId) : [],
    manage ? eligibleStores(companyId) : [],
    manage ? listAssignments(companyId) : [],
  ]);

  return (
    <RepsScreen
      manage={manage}
      canVisit={await hasPermission(access!, 'SALES_REPS', 'CREATE')}
      stores={stores}
      reps={reps}
      customers={customers}
      assignments={assignments}
    />
  );
}
