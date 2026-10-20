import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { recordSwipe } from '@/lib/feed/swipe';
import { checkout } from '@/lib/orders/checkout';
import { changeStatus, confirmOrder } from '@/lib/orders/workflow';
import { createWaybillAndInvoice } from '@/lib/documents/create';
import { acceptDelivery } from '@/lib/acceptance/accept';
import { confirmOnlinePayment, startOnlinePayment } from '@/lib/payments/online';
import { getSignatures, signDocumentByCompany } from '@/lib/documents/signature';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

/** Заявка, доведённая до ожидания оплаты: её можно оплатить онлайн. */
async function orderAwaitingPayment(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7783${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7784${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(600 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(601 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 190' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(240000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 10 }),
      ]),
    ),
  );

  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: store.companyId },
  });
  const offer = await prisma.supplierOffer.findFirstOrThrow({
    where: { supplierId: supplier.companyId },
  });
  await recordSwipe(store.companyId, location.id, offer.id, 'LIKE');

  const created = await checkout({
    storeId: store.companyId,
    locationId: location.id,
    cityId: taraz.id,
    userId: storeUser.id,
  });
  if (created.status !== 'created') throw new Error(created.status);
  const orderId = created.orders[0]!.id;

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  await confirmOrder(
    orderId,
    supplier.companyId,
    supplierUser.id,
    order.items.map((item) => ({
      orderItemId: item.id,
      quantityConfirmed: item.quantityOrdered.toFixed(3),
    })),
  );
  await createWaybillAndInvoice(orderId, supplier.companyId);
  for (const status of ['PICKING', 'SHIPPED', 'DELIVERED'] as const) {
    await changeStatus(orderId, supplier.companyId, supplierUser.id, status);
  }
  await acceptDelivery(
    orderId,
    store.companyId,
    storeUser.id,
    order.items.map((item) => ({
      orderItemId: item.id,
      quantityAccepted: item.quantityOrdered.toFixed(3),
      quantityDefective: '0.000',
    })),
  );
  await changeStatus(orderId, store.companyId, storeUser.id, 'AWAITING_PAYMENT');

  const invoice = await prisma.document.findFirstOrThrow({
    where: { orderId, type: 'INVOICE' },
  });

  return {
    orderId,
    invoiceId: invoice.id,
    storeId: store.companyId,
    storeUserId: storeUser.id,
    supplierId: supplier.companyId,
    supplierUserId: supplierUser.id,
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.auditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('онлайн-оплата заявки', () => {
  it('payment_gives_link_and_qr', async () => {
    const context = await orderAwaitingPayment(1);

    const result = await startOnlinePayment(context.orderId, context.storeId);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.payUrl.startsWith('https://')).toBe(true);
    expect(result.qrPayload.length).toBeGreaterThan(0);
    // Правило 1: сумма платежа равна сумме заявки с двумя знаками.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    expect(result.amount).toBe(order.totalWithVat.toFixed(2));
  });

  it('second_attempt_reuses_pending_payment', async () => {
    const context = await orderAwaitingPayment(2);

    const first = await startOnlinePayment(context.orderId, context.storeId);
    const second = await startOnlinePayment(context.orderId, context.storeId);

    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('оплата');
    expect(second.replayed).toBe(true);
    expect(second.paymentId).toBe(first.paymentId);
    expect(await prisma.onlinePayment.count({ where: { orderId: context.orderId } })).toBe(1);
  });

  it('callback_marks_order_paid_once', async () => {
    const context = await orderAwaitingPayment(3);
    const started = await startOnlinePayment(context.orderId, context.storeId);
    if (started.status !== 'ok') throw new Error(started.status);

    const payment = await prisma.onlinePayment.findUniqueOrThrow({
      where: { id: started.paymentId },
    });
    const confirmed = await confirmOnlinePayment(payment.externalId, true);
    expect(confirmed).toMatchObject({ status: 'ok', replayed: false });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    expect(order.status).toBe('PAID');
    expect(await prisma.payment.count({ where: { orderId: context.orderId } })).toBe(1);

    // Правило 10: повторный колбэк не создаёт второй платёж.
    const again = await confirmOnlinePayment(payment.externalId, true);
    expect(again).toMatchObject({ status: 'ok', replayed: true });
    expect(await prisma.payment.count({ where: { orderId: context.orderId } })).toBe(1);

    // Обе стороны получили уведомление.
    const notified = await prisma.notification.findMany({
      where: { event: 'order_status_changed' },
      select: { companyId: true },
    });
    expect(new Set(notified.map((row) => row.companyId))).toEqual(
      new Set([context.storeId, context.supplierId]),
    );
  });

  it('failed_callback_keeps_order_unpaid', async () => {
    const context = await orderAwaitingPayment(4);
    const started = await startOnlinePayment(context.orderId, context.storeId);
    if (started.status !== 'ok') throw new Error(started.status);
    const payment = await prisma.onlinePayment.findUniqueOrThrow({
      where: { id: started.paymentId },
    });

    expect(await confirmOnlinePayment(payment.externalId, false)).toEqual({ status: 'failed' });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    expect(order.status).toBe('AWAITING_PAYMENT');
    expect(await prisma.payment.count({ where: { orderId: context.orderId } })).toBe(0);
  });

  it('another_company_and_unknown_payment_are_refused', async () => {
    const context = await orderAwaitingPayment(5);

    // Правило 4: чужую заявку оплатить нельзя.
    expect(await startOnlinePayment(context.orderId, context.supplierId)).toEqual({
      status: 'not_found',
    });
    expect(await confirmOnlinePayment('no-such-payment', true)).toEqual({ status: 'not_found' });
  });
});

describe('подпись ЭЦП', () => {
  it('both_parties_can_sign_the_document', async () => {
    const context = await orderAwaitingPayment(6);

    const bySupplier = await signDocumentByCompany(
      context.invoiceId,
      context.supplierId,
      context.supplierUserId,
    );
    const byStore = await signDocumentByCompany(
      context.invoiceId,
      context.storeId,
      context.storeUserId,
    );

    expect(bySupplier.status).toBe('ok');
    expect(byStore.status).toBe('ok');
    const signatures = await getSignatures(context.invoiceId);
    expect(signatures).toHaveLength(2);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'document_signed', companyId: context.supplierId },
    });
    expect(audit.entityId).toBe(context.invoiceId);
  });

  it('second_signature_of_the_same_company_is_not_created', async () => {
    const context = await orderAwaitingPayment(7);

    const first = await signDocumentByCompany(
      context.invoiceId,
      context.storeId,
      context.storeUserId,
    );
    const again = await signDocumentByCompany(
      context.invoiceId,
      context.storeId,
      context.storeUserId,
    );

    if (first.status !== 'ok' || again.status !== 'ok') throw new Error('подпись');
    expect(again.replayed).toBe(true);
    expect(again.certificate).toBe(first.certificate);
    expect(await getSignatures(context.invoiceId)).toHaveLength(1);
  });

  it('outsider_cannot_sign', async () => {
    const context = await orderAwaitingPayment(8);
    const outsider = await orderAwaitingPayment(9);

    // Правило 4: подписывает только сторона документа.
    expect(
      await signDocumentByCompany(context.invoiceId, outsider.storeId, outsider.storeUserId),
    ).toEqual({ status: 'not_a_party' });
    expect(
      await signDocumentByCompany('no-such-document', context.storeId, context.storeUserId),
    ).toEqual({ status: 'not_found' });
  });
});
