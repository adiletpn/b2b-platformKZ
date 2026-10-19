import Decimal from 'decimal.js';
import type { OrderStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';
import { LONG_TRANSACTION } from '@/lib/db-tx';

/** Допустимые переходы статусов. Раздел 5.2 ТЗ. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['ACCEPTED', 'CHANGED_BY_SUPPLIER', 'REJECTED', 'CANCELLED'],
  CHANGED_BY_SUPPLIER: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PICKING', 'CANCELLED'],
  REJECTED: [],
  // С «Собирается» отмена магазином уже невозможна (раздел 5.2 ТЗ).
  PICKING: ['SHIPPED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['ACCEPTED_BY_STORE', 'ACCEPTED_WITH_DISCREPANCY'],
  ACCEPTED_BY_STORE: ['AWAITING_PAYMENT'],
  ACCEPTED_WITH_DISCREPANCY: ['AWAITING_PAYMENT'],
  AWAITING_PAYMENT: ['PAID'],
  PAID: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

/** Кто имеет право переводить заявку в конкретный статус. */
const ACTOR: Record<OrderStatus, 'store' | 'supplier' | 'both'> = {
  DRAFT: 'store',
  SENT: 'store',
  ACCEPTED: 'both',
  CHANGED_BY_SUPPLIER: 'supplier',
  REJECTED: 'supplier',
  PICKING: 'supplier',
  SHIPPED: 'supplier',
  DELIVERED: 'supplier',
  ACCEPTED_BY_STORE: 'store',
  ACCEPTED_WITH_DISCREPANCY: 'store',
  AWAITING_PAYMENT: 'both',
  PAID: 'both',
  CLOSED: 'both',
  CANCELLED: 'store',
};

export type Side = 'store' | 'supplier';

export type TransitionResult =
  | { status: 'ok'; orderStatus: OrderStatus }
  | { status: 'forbidden_transition'; from: OrderStatus; to: OrderStatus }
  | { status: 'wrong_side' }
  | { status: 'not_found' };

export function sideOf(
  order: { storeId: string; supplierId: string },
  companyId: string,
): Side | null {
  if (order.storeId === companyId) return 'store';
  if (order.supplierId === companyId) return 'supplier';
  return null;
}

export async function changeStatus(
  orderId: string,
  companyId: string,
  userId: string,
  to: OrderStatus,
  comment?: string,
): Promise<TransitionResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { status: 'not_found' };

  // Правило 4: заявка доступна только своим сторонам.
  const side = sideOf(order, companyId);
  if (!side) return { status: 'not_found' };

  if (!TRANSITIONS[order.status].includes(to)) {
    return { status: 'forbidden_transition', from: order.status, to };
  }
  const allowed = ACTOR[to];
  if (allowed !== 'both' && allowed !== side) return { status: 'wrong_side' };

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: to, ...(to === 'REJECTED' ? { rejectionReason: comment ?? null } : {}) },
    });
    await tx.orderStatusLog.create({
      data: { orderId, fromStatus: order.status, toStatus: to, userId, comment: comment ?? null },
    });
  });

  const counterparty = side === 'store' ? order.supplierId : order.storeId;
  await notify(counterparty, 'order_status_changed', { number: order.number, status: to }, orderId);

  return { status: 'ok', orderStatus: to };
}

export type ConfirmationLine = { orderItemId: string; quantityConfirmed: string };

export type ConfirmResult =
  | { status: 'ok'; orderStatus: OrderStatus; total: string }
  | { status: 'not_found' }
  | { status: 'forbidden_transition'; from: OrderStatus; to: OrderStatus }
  | { status: 'invalid_quantity'; orderItemId: string };

/**
 * Поставщик подтверждает заявку. Если хотя бы одна позиция урезана,
 * заявка уходит в «Изменена поставщиком» и ждёт согласия магазина (раздел 3.4 ТЗ).
 */
export async function confirmOrder(
  orderId: string,
  supplierId: string,
  userId: string,
  lines: ConfirmationLine[],
): Promise<ConfirmResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order || order.supplierId !== supplierId) return { status: 'not_found' };

  if (!TRANSITIONS[order.status].includes('ACCEPTED')) {
    return { status: 'forbidden_transition', from: order.status, to: 'ACCEPTED' };
  }

  const byId = new Map(order.items.map((item) => [item.id, item]));
  const confirmations = new Map<string, Decimal>();

  for (const line of lines) {
    const item = byId.get(line.orderItemId);
    if (!item) return { status: 'invalid_quantity', orderItemId: line.orderItemId };

    const quantity = new Decimal(line.quantityConfirmed);
    if (quantity.isNaN() || quantity.isNegative() || quantity.decimalPlaces() > 3) {
      return { status: 'invalid_quantity', orderItemId: line.orderItemId };
    }
    if (quantity.greaterThan(new Decimal(item.quantityOrdered.toString()))) {
      return { status: 'invalid_quantity', orderItemId: line.orderItemId };
    }
    confirmations.set(line.orderItemId, quantity);
  }

  let total = new Decimal(0);
  let changed = false;

  for (const item of order.items) {
    const ordered = new Decimal(item.quantityOrdered.toString());
    const confirmed = confirmations.get(item.id) ?? ordered;
    if (!confirmed.equals(ordered)) changed = true;
    total = total.plus(
      new Decimal(item.priceWithVat.toString())
        .times(confirmed)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
    );
  }

  const nextStatus: OrderStatus = changed ? 'CHANGED_BY_SUPPLIER' : 'ACCEPTED';

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      const confirmed = confirmations.get(item.id) ?? new Decimal(item.quantityOrdered.toString());
      await tx.orderItem.update({
        where: { id: item.id },
        data: { quantityConfirmed: confirmed.toFixed(3) },
      });
    }
    await tx.order.update({
      where: { id: orderId },
      data: { status: nextStatus, totalWithVat: total.toFixed(2) },
    });
    await tx.orderStatusLog.create({
      data: { orderId, fromStatus: order.status, toStatus: nextStatus, userId },
    });
  }, LONG_TRANSACTION);

  await notify(
    order.storeId,
    changed ? 'order_changed_by_supplier' : 'order_accepted',
    { number: order.number, total: total.toFixed(2) },
    orderId,
  );

  return { status: 'ok', orderStatus: nextStatus, total: total.toFixed(2) };
}

/** Магазин соглашается с урезанной заявкой или отказывается от неё. */
export async function respondToChanges(
  orderId: string,
  storeId: string,
  userId: string,
  agree: boolean,
) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.storeId !== storeId) return { status: 'not_found' as const };
  if (order.status !== 'CHANGED_BY_SUPPLIER') {
    return { status: 'forbidden_transition' as const, from: order.status, to: 'ACCEPTED' as const };
  }

  const to: OrderStatus = agree ? 'ACCEPTED' : 'CANCELLED';
  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { status: to } });
    await tx.orderStatusLog.create({
      data: { orderId, fromStatus: order.status, toStatus: to, userId },
    });
  });

  await notify(
    order.supplierId,
    agree ? 'order_changes_approved' : 'order_cancelled',
    { number: order.number },
    orderId,
  );

  return { status: 'ok' as const, orderStatus: to };
}
