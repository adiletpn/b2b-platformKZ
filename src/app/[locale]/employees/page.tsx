import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { prisma } from '@/lib/prisma';
import { maskPhone } from '@/lib/phone';
import { EmployeesScreen } from './employees-screen';

export default async function EmployeesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  const access = await getAccess();
  if (!access) redirect({ href: '/login', locale });

  // Раздел 3.12 ТЗ: раздел виден только тем, у кого есть право на сотрудников.
  const allowed = await hasPermission(access!, 'EMPLOYEES_REQUISITES', 'VIEW');
  if (!allowed) redirect({ href: '/dashboard', locale });

  const companyId = access!.companyId;
  const [memberships, invitations, audit, roles] = await Promise.all([
    prisma.membership.findMany({
      where: { companyId },
      include: { user: true, customRole: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { companyId, status: 'PENDING' },
      include: { role: true },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.role.findMany({ where: { companyId: null }, orderBy: { code: 'asc' } }),
  ]);

  return (
    <EmployeesScreen
      roles={roles.map((role) => role.code)}
      employees={memberships.map((membership) => ({
        id: membership.id,
        phone: maskPhone(membership.user.phone),
        role: membership.customRole?.code ?? membership.role,
        status: membership.status,
      }))}
      invitations={invitations.map((invitation) => ({
        id: invitation.id,
        phone: maskPhone(invitation.phone),
        role: invitation.role.code,
        expiresAt: invitation.expiresAt.toLocaleDateString('ru-RU'),
      }))}
      audit={audit.map((entry) => ({
        id: entry.id,
        action: entry.action,
        createdAt: entry.createdAt.toLocaleString('ru-RU'),
      }))}
    />
  );
}
