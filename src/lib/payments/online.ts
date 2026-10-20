import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';
import { createGatewayPayment } from '@/mocks/payment-gateway';

export type OnlinePaymentResult =
  | {
      status: 'ok';
      paymentId: string;
      payUrl: string;
      qrPayload: string;
      amount: string;
      replayed: boolean;
    }
  | { status: 'not_found' }
  | { status: 'wrong_status'; current: string };

/**
 * Раздел 3.6 ТЗ: онлайн-оплата заявки. Создаём платёж в шлюзе и отдаём ссылку с QR.
 * Повторный вызов отдаёт уже созданный платёж, а не заводит второй.
 */
export async function startOnlinePayment(
  orderId: string,
  storeId: string,
  provider = 'kaspi',
): Promise<OnlinePaymentResult> {
  // Правило 4: платит магазин своей заявки.
  const order = await prisma.order.findFirst({ where: { id: orderId, storeId } });
  if (!order) return { status: 'not_found' };
  if (order.status !== 'AWAITING_PAYMENT' && order.status !== 'OVERDUE') {
    return { status: 'wrong_status', current: order.status };
  }

  const existing = await prisma.onlinePayment.findFirst({
    where: { orderId, status: 'PENDING' },
  });
  if (existing) {
    return {
      status: 'ok',
      paymentId: existing.id,
      payUrl: existing.payUrl,
      qrPayload: existing.qrPayload,
      amount: existing.amount.toFixed(2),
      replayed: true,
    };
  }

  const amount = new Decimal(order.totalWithVat.toString()).toFixed(2);
  const gateway = createGatewayPayment(order.number, amount, provider);

  const payment = await prisma.onlinePayment.create({
    data: {
      orderId,
      provider: gateway.provider,
      amount,
      externalId: gateway.externalId,
      payUrl: gateway.payUrl,
      qrPayload: gateway.qrPayload,
    },
  });

  return {
    status: 'ok',
    paymentId: payment.id,
    payUrl: payment.payUrl,
    qrPayload: payment.qrPayload,
    amount,
    replayed: false,
  };
}

export type ConfirmResult =
  | { status: 'ok'; paymentId: string; replayed: boolean }
  | { status: 'not_found' }
  | { status: 'failed' };

/**
 * Колбэк шлюза. Повторный колбэк не создаёт второй `Payment`: платёж уже оплачен,
 * возвращаем тот же результат (раздел 3.6 ТЗ и правило 10).
 */
export async function confirmOnlinePayment(
  externalId: string,
  paid: boolean,
): Promise<ConfirmResult> {
  const payment = await prisma.onlinePayment.findUnique({
    where: { externalId },
    include: { order: true },
  });
  if (!payment) return { status: 'not_found' };
  if (payment.status === 'PAID') return { status: 'ok', paymentId: payment.id, replayed: true };

  if (!paid) {
    await prisma.onlinePayment.update({
      where: { id: payment.id },
      data: { status: 'FAILED' },
    });
    return { status: 'failed' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.onlinePayment.update({
      where: { id: payment.id },
      data: { status: 'PAID', confirmedAt: new Date() },
    });
    await tx.payment.create({
      data: {
        orderId: payment.orderId,
        amount: payment.amount,
        method: payment.order.paymentMethod,
        status: 'PAID',
        reference: payment.externalId,
        paidAt: new Date(),
      },
    });
    await tx.order.update({ where: { id: payment.orderId }, data: { status: 'PAID' } });
    await tx.orderStatusLog.create({
      data: {
        orderId: payment.orderId,
        fromStatus: payment.order.status,
        toStatus: 'PAID',
        comment: `онлайн-оплата ${payment.provider}`,
      },
    });
  });

  for (const companyId of [payment.order.storeId, payment.order.supplierId]) {
    await notify(companyId, 'order_status_changed', {
      number: payment.order.number,
      status: 'PAID',
    });
  }

  return { status: 'ok', paymentId: payment.id, replayed: false };
}
