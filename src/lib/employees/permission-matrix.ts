import type { PermissionAction, PermissionSection } from '@/generated/prisma/enums';

/** Разделы и действия матрицы прав — список для экрана, сами права живут в БД (правило 5). */
export const PERMISSION_SECTIONS = [
  'CATALOG',
  'SWIPE_ORDERS',
  'ACCEPTANCE',
  'POS',
  'STOCK',
  'PURCHASE_PRICES',
  'DOCUMENTS_PAYMENTS',
  'EMPLOYEES_REQUISITES',
  'DELIVERIES',
] as const satisfies readonly PermissionSection[];

export const PERMISSION_ACTIONS = [
  'VIEW',
  'CREATE',
  'UPDATE',
  'DELETE',
  'SIGN',
  'EXPORT',
] as const satisfies readonly PermissionAction[];

export type PermissionCell = { section: PermissionSection; action: PermissionAction };

/** Точка доступна сотруднику, если ограничения нет или она в списке (раздел 3.12 ТЗ). */
export function locationAllowed(allowedLocationIds: string[], locationId: string) {
  return allowedLocationIds.length === 0 || allowedLocationIds.includes(locationId);
}
