import type { PermissionAction, PermissionSection } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { getSession } from './session';

export type AccessContext = {
  userId: string;
  companyId: string;
  membershipId: string;
  roleCode: string;
  /** Пусто — доступны все точки компании (раздел 3.12 ТЗ). */
  allowedLocationIds: string[];
  orderLimit: string | null;
};

/**
 * Права сотрудника. Матрица лежит в справочнике ролей в БД (правило 5):
 * своя роль компании, иначе системный шаблон по коду роли.
 */
export async function getAccess(): Promise<AccessContext | null> {
  const session = await getSession();
  if (!session) return null;

  const membership =
    session.user.memberships.find(
      (item) => item.companyId === session.activeCompanyId && item.status === 'ACTIVE',
    ) ?? session.user.memberships.find((item) => item.status === 'ACTIVE');

  // Правило 4 и раздел 3.12: заблокированный сотрудник доступа не имеет.
  if (!membership) return null;

  return {
    userId: session.userId,
    companyId: membership.companyId,
    membershipId: membership.id,
    roleCode: membership.role,
    allowedLocationIds: membership.allowedLocationIds,
    orderLimit: membership.orderLimit?.toFixed(2) ?? null,
  };
}

export async function hasPermission(
  access: AccessContext,
  section: PermissionSection,
  action: PermissionAction,
): Promise<boolean> {
  const membership = await prisma.membership.findUnique({
    where: { id: access.membershipId },
    select: { roleId: true, role: true, status: true },
  });
  if (!membership || membership.status !== 'ACTIVE') return false;

  const role = membership.roleId
    ? await prisma.role.findUnique({ where: { id: membership.roleId } })
    : await prisma.role.findFirst({ where: { companyId: null, code: membership.role } });
  if (!role) return false;

  const permission = await prisma.permission.findUnique({
    where: { roleId_section_action: { roleId: role.id, section, action } },
  });
  return permission !== null;
}

export type Guard = { ok: true; access: AccessContext } | { ok: false; status: 401 | 403 };

/** Проверка доступа для маршрута: 401 без сессии, 403 без права. */
export async function requirePermission(
  section: PermissionSection,
  action: PermissionAction,
): Promise<Guard> {
  const access = await getAccess();
  if (!access) return { ok: false, status: 401 };
  if (!(await hasPermission(access, section, action))) return { ok: false, status: 403 };
  return { ok: true, access };
}

/** Журнал действий сотрудников (раздел 3.12 ТЗ). */
export async function writeAudit(
  companyId: string,
  userId: string | null,
  action: string,
  entity?: string,
  entityId?: string,
) {
  await prisma.auditLog.create({
    data: { companyId, userId, action, entity: entity ?? null, entityId: entityId ?? null },
  });
}

/** Флаги прав текущего сотрудника для экрана: какие кнопки показывать. */
export async function permissionFlags<A extends PermissionAction>(
  section: PermissionSection,
  actions: readonly A[],
): Promise<Record<A, boolean>> {
  const access = await getAccess();
  const entries = await Promise.all(
    actions.map(async (action) => [
      action,
      access ? await hasPermission(access, section, action) : false,
    ]),
  );
  return Object.fromEntries(entries) as Record<A, boolean>;
}
