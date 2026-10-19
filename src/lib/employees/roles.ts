import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/auth/permissions';
import { PERMISSION_ACTIONS, PERMISSION_SECTIONS, type PermissionCell } from './permission-matrix';

export { PERMISSION_ACTIONS, PERMISSION_SECTIONS, type PermissionCell } from './permission-matrix';

export type RoleResult =
  | { status: 'ok'; roleId: string }
  | { status: 'name_required' }
  | { status: 'permissions_required' }
  | { status: 'duplicate_code' };

function roleCode(nameRu: string) {
  // Код своей роли не вводится руками: берём из названия, чтобы не путать с шаблонами.
  const slug = nameRu
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-ZА-ЯЁ]+/gu, '_')
    .slice(0, 24);
  return `CUSTOM_${slug || 'ROLE'}`;
}

/**
 * Своя роль компании: права отмечаются в матрице «раздел × действие» (раздел 3.12 ТЗ).
 * Матрица остаётся в справочнике БД (правило 5), в коде её нет.
 */
export async function createCustomRole(
  companyId: string,
  actorId: string,
  input: { nameRu: string; nameKk: string; permissions: PermissionCell[] },
): Promise<RoleResult> {
  if (!input.nameRu.trim() || !input.nameKk.trim()) return { status: 'name_required' };
  if (input.permissions.length === 0) return { status: 'permissions_required' };

  const code = roleCode(input.nameRu);
  const existing = await prisma.role.findFirst({ where: { companyId, code } });
  if (existing) return { status: 'duplicate_code' };

  const allowed = input.permissions.filter(
    (cell) =>
      PERMISSION_SECTIONS.includes(cell.section) && PERMISSION_ACTIONS.includes(cell.action),
  );
  if (allowed.length === 0) return { status: 'permissions_required' };

  const role = await prisma.role.create({
    data: {
      companyId,
      code,
      nameRu: input.nameRu.trim(),
      nameKk: input.nameKk.trim(),
      isTemplate: false,
      permissions: {
        create: allowed.map((cell) => ({ section: cell.section, action: cell.action })),
      },
    },
  });

  await writeAudit(companyId, actorId, 'role_created', 'Role', role.id);
  return { status: 'ok', roleId: role.id };
}

export type AccessUpdate = {
  roleId?: string | null;
  allowedLocationIds?: string[];
  orderLimit?: string | null;
  maxDiscount?: string | null;
};

export type AccessResult =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'owner_not_limited' }
  | { status: 'invalid_amount' };

function parseAmount(value: string | null | undefined, places: number) {
  if (value === undefined) return undefined;
  if (value === null || value.trim() === '') return null;
  const amount = new Decimal(value.replace(',', '.'));
  if (!amount.isFinite() || amount.isNegative()) throw new Error('invalid_amount');
  return amount.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
}

/** Точки, лимит заявки и максимальная скидка сотрудника (раздел 3.12 ТЗ). */
export async function updateEmployeeAccess(
  companyId: string,
  actorId: string,
  membershipId: string,
  input: AccessUpdate,
): Promise<AccessResult> {
  const membership = await prisma.membership.findFirst({
    where: { id: membershipId, companyId },
  });
  if (!membership) return { status: 'not_found' };
  // Владелец отвечает за компанию целиком, ограничивать его нельзя.
  if (membership.role === 'OWNER') return { status: 'owner_not_limited' };

  let orderLimit: string | null | undefined;
  let maxDiscount: string | null | undefined;
  try {
    orderLimit = parseAmount(input.orderLimit, 2);
    maxDiscount = parseAmount(input.maxDiscount, 2);
  } catch {
    return { status: 'invalid_amount' };
  }
  if (
    maxDiscount !== undefined &&
    maxDiscount !== null &&
    new Decimal(maxDiscount).greaterThan(100)
  )
    return { status: 'invalid_amount' };

  if (input.roleId) {
    const role = await prisma.role.findFirst({
      where: { id: input.roleId, OR: [{ companyId }, { companyId: null }] },
    });
    if (!role) return { status: 'not_found' };
  }

  // Правило 4: назначить можно только точки своей компании.
  let locationIds: string[] | undefined;
  if (input.allowedLocationIds) {
    const locations = await prisma.location.findMany({
      where: { companyId, id: { in: input.allowedLocationIds } },
      select: { id: true },
    });
    locationIds = locations.map((location) => location.id);
  }

  await prisma.membership.update({
    where: { id: membershipId },
    data: {
      ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
      ...(locationIds ? { allowedLocationIds: locationIds } : {}),
      ...(orderLimit !== undefined ? { orderLimit } : {}),
      ...(maxDiscount !== undefined ? { maxDiscount } : {}),
    },
  });

  await writeAudit(companyId, actorId, 'employee_access_changed', 'Membership', membershipId);
  return { status: 'ok' };
}
