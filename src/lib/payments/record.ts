import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';

export type RecordPaymentInput = {
  orderId: string;
  storeId: string;
  userId: string;
  amount: string;
  method: 'PREPAY' | 'ON_DELIVERY' | 'DEFERRED';
  paidAt: string;
  reference?: string;
};

export type RecordPaymentResult =
  | { status: 'ok'; paymentId: string; amount: string }
  | { status: 'not_found' }
  | { status: 'wrong_status'; current: string }
  | { status: 'invalid_amount' }
  | { status: 'invalid_date' };

/**
 * Раздел 3.6 ТЗ: отметка об оплате вручную. Платёжного шлюза в демо нет.
 * Сумма должна совпадать с суммой заявки после приёмки.
 */
export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    include: { documents: true },
  });
  if (!order || order.storeId !== input.storeId) return { status: 'not_found' };
  if (order.status !== 'AWAITING_PAYMENT') return { status: 'wrong_status', current: order.status };

  const amount = new Decimal(input.amount.replace(',', '.') || '0');
  if (amount.isNaN() || amount.lessThanOrEqualTo(0) || amount.decimalPlaces() > 2) {
    return { status: 'invalid_amount' };
  }
  if (!amount.equals(new Decimal(order.totalWithVat.toString()))) {
    return { status: 'invalid_amount' };
  }

  const paidAt = new Date(input.paidAt);
  if (Number.isNaN(paidAt.getTime())) return { status: 'invalid_date' };

  const invoice = order.documents.find((document) => document.type === 'INVOICE');

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        orderId: order.id,
        documentId: invoice?.id ?? null,
        amount: amount.toFixed(2),
        method: input.method,
        status: 'PAID',
        reference: input.reference ?? null,
        paidAt,
      },
    });

    await tx.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
    await tx.orderStatusLog.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: 'PAID',
        userId: input.userId,
      },
    });

    return created;
  });

  await notify(
    order.supplierId,
    'order_status_changed',
    { number: order.number, status: 'PAID' },
    order.id,
  );

  return { status: 'ok', paymentId: payment.id, amount: amount.toFixed(2) };
}
