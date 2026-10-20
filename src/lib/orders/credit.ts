import Decimal from 'decimal.js';
import type { OrderStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';

/** Статусы, в которых заявка уже стала или станет долгом магазина. */
const OPEN_DEBT: OrderStatus[] = [
  'SENT',
  'ACCEPTED',
  'CHANGED_BY_SUPPLIER',
  'PICKING',
  'SHIPPED',
  'DELIVERED',
  'ACCEPTED_BY_STORE',
  'ACCEPTED_WITH_DISCREPANCY',
  'AWAITING_PAYMENT',
  'OVERDUE',
  'DISPUTE',
];

export type CreditCheck = {
  limit: string | null;
  debt: string;
  /** Новая сумма не помещается в лимит. */
  exceeded: boolean;
};

/**
 * Кредитный лимит поставщика на магазин (раздел 3.6 ТЗ): неоплаченные и открытые
 * заявки магазина у этого поставщика плюс новая сумма не должны превышать лимит.
 */
export async function checkCredit(
  storeId: string,
  supplierId: string,
  amount: Decimal.Value,
  excludeOrderId?: string,
): Promise<CreditCheck> {
  const supplier = await prisma.company.findUnique({
    where: { id: supplierId },
    select: { creditLimit: true },
  });
  const open = await prisma.order.findMany({
    where: {
      storeId,
      supplierId,
      status: { in: OPEN_DEBT },
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
    select: { totalWithVat: true },
  });
  const debt = open.reduce((sum, order) => sum.plus(order.totalWithVat.toString()), new Decimal(0));
  if (!supplier?.creditLimit) return { limit: null, debt: debt.toFixed(2), exceeded: false };

  return {
    limit: supplier.creditLimit.toFixed(2),
    debt: debt.toFixed(2),
    exceeded: debt.plus(amount).greaterThan(supplier.creditLimit.toString()),
  };
}

export type ResendResult =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'still_exceeded'; limit: string; debt: string };

/** Магазин снова отправляет заявку с паузы, когда долг уменьшился. */
export async function resendHeldOrder(
  orderId: string,
  storeId: string,
  userId: string,
): Promise<ResendResult> {
  // Правило 4: только своя заявка на паузе.
  const order = await prisma.order.findFirst({
    where: { id: orderId, storeId, status: 'DRAFT', creditHold: true, needsApproval: false },
  });
  if (!order) return { status: 'not_found' };

  const credit = await checkCredit(
    storeId,
    order.supplierId,
    order.totalWithVat.toString(),
    order.id,
  );
  if (credit.exceeded) {
    return { status: 'still_exceeded', limit: credit.limit!, debt: credit.debt };
  }

  await prisma.$transaction([
    prisma.order.update({ where: { id: orderId }, data: { status: 'SENT', creditHold: false } }),
    prisma.orderStatusLog.create({
      data: { orderId, fromStatus: 'DRAFT', toStatus: 'SENT', userId },
    }),
  ]);
  await notify(
    order.supplierId,
    'order_created',
    { number: order.number, total: order.totalWithVat.toFixed(2) },
    orderId,
  );
  return { status: 'ok' };
}
