import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';
import { writeAudit } from '@/lib/auth/permissions';
import { maskPhone } from '@/lib/phone';
import { checkCredit } from './credit';

/** Лимит заявки без согласования у сотрудника магазина (раздел 3.12 ТЗ). */
export async function orderLimitFor(companyId: string, userId: string) {
  const membership = await prisma.membership.findFirst({
    where: { companyId, userId, status: 'ACTIVE' },
    select: { orderLimit: true },
  });
  if (!membership?.orderLimit) return null;
  return new Decimal(membership.orderLimit.toString());
}

export type ApprovalRow = {
  orderId: string;
  number: string;
  supplierName: string;
  total: string;
  authorPhone: string;
  createdAt: string;
};

export async function listPendingApprovals(companyId: string): Promise<ApprovalRow[]> {
  const orders = await prisma.order.findMany({
    where: { storeId: companyId, needsApproval: true, status: 'DRAFT' },
    include: { supplier: { select: { name: true } }, createdBy: { select: { phone: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return orders.map((order) => ({
    orderId: order.id,
    number: order.number,
    supplierName: order.supplier.name,
    total: order.totalWithVat.toFixed(2),
    // Правило 11: телефон в списках только маской.
    authorPhone: order.createdBy ? maskPhone(order.createdBy.phone) : '—',
    createdAt: order.createdAt.toISOString(),
  }));
}

export type ApprovalResult =
  | { status: 'ok'; order: 'SENT' | 'CANCELLED' | 'DRAFT' }
  | { status: 'not_found' }
  | { status: 'reason_required' };

/**
 * Владелец согласует заявку выше лимита или отклоняет её с причиной.
 * Только после согласования заявка уходит поставщику.
 */
export async function decideApproval(
  companyId: string,
  approverId: string,
  orderId: string,
  approved: boolean,
  reason?: string,
): Promise<ApprovalResult> {
  // Правило 4: чужую заявку согласовать нельзя.
  const order = await prisma.order.findFirst({
    where: { id: orderId, storeId: companyId, needsApproval: true, status: 'DRAFT' },
  });
  if (!order) return { status: 'not_found' };
  if (!approved && !reason?.trim()) return { status: 'reason_required' };

  // Согласованная заявка всё равно ждёт, если превышен кредитный лимит поставщика.
  const held =
    approved &&
    (await checkCredit(companyId, order.supplierId, order.totalWithVat.toString(), order.id))
      .exceeded;
  const status = !approved ? 'CANCELLED' : held ? 'DRAFT' : 'SENT';

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status,
        needsApproval: false,
        creditHold: held,
        approvedById: approverId,
        approvedAt: new Date(),
        rejectionReason: approved ? null : reason!.trim(),
      },
    });
    await tx.orderStatusLog.create({
      data: {
        orderId,
        fromStatus: 'DRAFT',
        toStatus: status,
        userId: approverId,
        comment: approved ? null : reason!.trim(),
      },
    });
  });

  await writeAudit(
    companyId,
    approverId,
    approved ? 'order_approved' : 'order_approval_rejected',
    'Order',
    orderId,
  );

  if (status === 'SENT') {
    await notify(
      order.supplierId,
      'order_created',
      { number: order.number, total: order.totalWithVat.toFixed(2) },
      orderId,
    );
  }

  return { status: 'ok', order: status };
}
