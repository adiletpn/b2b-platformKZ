import type { PermissionAction, PermissionSection } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { maskPhone } from '@/lib/phone';

export type MemberOption = { membershipId: string; label: string; isOwner: boolean };

/**
 * Активные сотрудники компании, у роли которых есть право: своя роль или системный
 * шаблон по коду (матрица прав в БД, правило 5). Телефон на экране — маской (правило 11).
 */
export async function membersWithPermission(
  companyId: string,
  section: PermissionSection,
  action: PermissionAction,
): Promise<MemberOption[]> {
  const [memberships, templates] = await Promise.all([
    prisma.membership.findMany({
      where: { companyId, status: 'ACTIVE' },
      include: {
        user: { select: { name: true, phone: true } },
        customRole: { include: { permissions: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.role.findMany({ where: { companyId: null }, include: { permissions: true } }),
  ]);
  const byCode = new Map(templates.map((role) => [role.code, role]));
  return memberships
    .filter((membership) =>
      (membership.customRole ?? byCode.get(membership.role))?.permissions.some(
        (permission) => permission.section === section && permission.action === action,
      ),
    )
    .map((membership) => ({
      membershipId: membership.id,
      label: membership.user.name ?? maskPhone(membership.user.phone),
      isOwner: membership.role === 'OWNER',
    }));
}
