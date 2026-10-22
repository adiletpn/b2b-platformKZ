import type { OrderStatus, Prisma } from '@/generated/prisma/client';

/**
 * Вкладки списка заявок (макеты M07 и D02). На телефоне видны «Активные» и «Архив»,
 * на компьютере ещё «Требуют действия», «В пути» и «Ожидают оплаты».
 */
export const ORDER_TABS = ['active', 'action', 'transit', 'payment', 'archive'] as const;
export type OrderTab = (typeof ORDER_TABS)[number];

export const ARCHIVE_STATUSES: OrderStatus[] = ['CLOSED', 'CANCELLED', 'REJECTED'];
const PAYMENT_STATUSES: OrderStatus[] = ['AWAITING_PAYMENT', 'OVERDUE'];
/** От магазина ждут ответа на изменения, приёмки или оплаты. */
const STORE_ACTION: OrderStatus[] = ['CHANGED_BY_SUPPLIER', 'DELIVERED', ...PAYMENT_STATUSES];
/** От поставщика ждут подтверждения новой заявки. */
const SUPPLIER_ACTION: OrderStatus[] = ['SENT'];

export function parseOrderTab(value: string | undefined): OrderTab {
  return ORDER_TABS.includes(value as OrderTab) ? (value as OrderTab) : 'active';
}

/** Условие вкладки для заявок компании. Черновики поставщику не видны (раздел 3.4 ТЗ). */
export function orderTabWhere(tab: OrderTab, companyId: string): Prisma.OrderWhereInput {
  const mine: Prisma.OrderWhereInput = {
    OR: [{ storeId: companyId }, { supplierId: companyId, status: { not: 'DRAFT' } }],
  };
  switch (tab) {
    case 'archive':
      return { AND: [mine, { status: { in: ARCHIVE_STATUSES } }] };
    case 'transit':
      return { AND: [mine, { status: 'SHIPPED' }] };
    case 'payment':
      return { AND: [mine, { status: { in: PAYMENT_STATUSES } }] };
    case 'action':
      return {
        OR: [
          { storeId: companyId, status: { in: STORE_ACTION } },
          { supplierId: companyId, status: { in: SUPPLIER_ACTION } },
        ],
      };
    default:
      return { AND: [mine, { status: { notIn: ARCHIVE_STATUSES } }] };
  }
}
