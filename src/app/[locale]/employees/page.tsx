import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getAccess, hasPermission } from '@/lib/auth/permissions';
import { getSession } from '@/lib/auth/session';
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
  const session = await getSession();
  const t = await getTranslations({ locale, namespace: 'employees' });
  const [memberships, invitations, audit, roles, locations] = await Promise.all([
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
      include: { user: { select: { phone: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.role.findMany({
      where: { OR: [{ companyId: null }, { companyId }] },
      orderBy: [{ isTemplate: 'desc' }, { code: 'asc' }],
    }),
    prisma.location.findMany({ where: { companyId }, orderBy: { createdAt: 'asc' } }),
  ]);

  return (
    <EmployeesScreen
      roles={roles.map((role) => ({
        id: role.id,
        code: role.code,
        // У шаблонов название берётся из переводов, у своей роли — из справочника компании.
        name: role.isTemplate
          ? t(`roles.${role.code}` as 'roles.CASHIER')
          : locale === 'kk'
            ? role.nameKk
            : role.nameRu,
        isTemplate: role.isTemplate,
      }))}
      locations={locations.map((location) => ({ id: location.id, address: location.address }))}
      employees={memberships.map((membership) => ({
        id: membership.id,
        phone: maskPhone(membership.user.phone),
        role: membership.customRole?.code ?? membership.role,
        roleId: membership.customRole?.id ?? null,
        status: membership.status,
        allowedLocationIds: membership.allowedLocationIds,
        orderLimit: membership.orderLimit?.toFixed(2) ?? '',
        maxDiscount: membership.maxDiscount?.toFixed(2) ?? '',
      }))}
      companies={(session?.user.memberships ?? [])
        .filter((membership) => membership.status === 'ACTIVE')
        .map((membership) => ({
          id: membership.companyId,
          name: membership.company.name,
          active: membership.companyId === companyId,
        }))}
      isOwner={access!.roleCode === 'OWNER'}
      invitations={invitations.map((invitation) => ({
        id: invitation.id,
        phone: maskPhone(invitation.phone),
        role: invitation.role.code,
        expiresAt: invitation.expiresAt.toLocaleDateString('ru-RU'),
      }))}
      audit={audit.map((entry) => ({
        id: entry.id,
        action: entry.action,
        actorPhone: entry.user ? maskPhone(entry.user.phone) : '—',
        createdAt: entry.createdAt.toLocaleString('ru-RU'),
      }))}
    />
  );
}
