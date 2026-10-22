import type { OrderStatus } from '@/generated/prisma/client';

/** Колонки канбана входящих заявок поставщика (макет D03). */
export const BOARD_COLUMNS = [
  'new',
  'waitingStore',
  'picking',
  'shipped',
  'waitingPayment',
] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

const BY_STATUS: Partial<Record<OrderStatus, BoardColumn>> = {
  SENT: 'new',
  CHANGED_BY_SUPPLIER: 'waitingStore',
  ACCEPTED: 'picking',
  PICKING: 'picking',
  SHIPPED: 'shipped',
  DELIVERED: 'shipped',
  ACCEPTED_BY_STORE: 'waitingPayment',
  ACCEPTED_WITH_DISCREPANCY: 'waitingPayment',
  AWAITING_PAYMENT: 'waitingPayment',
  OVERDUE: 'waitingPayment',
};

/** Колонка заявки или null: оплаченные, закрытые и спорные на доске не показываются. */
export function boardColumn(status: OrderStatus): BoardColumn | null {
  return BY_STATUS[status] ?? null;
}
