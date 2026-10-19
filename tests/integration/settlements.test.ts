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
import { recordPayment } from '@/lib/payments/record';
import { getReceivables, getSettlement, markOverdueOrders } from '@/lib/settlements/receivables';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

/** Заявка, доведённая до «Ожидает оплаты», с отсрочкой поставщика. */
async function awaitingPayment(index: number, deferralDays = 0) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7770${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7771${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(500 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(501 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 40' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await prisma.company.update({
    where: { id: supplier.companyId },
    data: {
      paymentTerms: deferralDays > 0 ? 'DEFERRED' : 'ON_DELIVERY',
      deferralDays: deferralDays > 0 ? deferralDays : null,
    },
  });

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(150000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 5 }),
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
    })),
  );
  await changeStatus(orderId, store.companyId, storeUser.id, 'AWAITING_PAYMENT');

  return {
    orderId,
    supplier: { id: supplier.companyId, userId: supplierUser.id },
    store: { id: store.companyId, userId: storeUser.id },
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('отсрочка и просрочка', () => {
  it('payment_due_date_follows_supplier_deferral', async () => {
    const context = await awaitingPayment(1, 14);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });

    expect(order.paymentDueDate).not.toBeNull();
    const days = Math.round(
      (order.paymentDueDate!.getTime() - new Date().setHours(0, 0, 0, 0)) / 86_400_000,
    );
    expect(days).toBeGreaterThanOrEqual(13);
    expect(days).toBeLessThanOrEqual(15);
  });

  it('order_becomes_overdue_after_due_date', async () => {
    const context = await awaitingPayment(2, 7);
    const past = new Date();
    past.setDate(past.getDate() - 3);
    await prisma.order.update({
      where: { id: context.orderId },
      data: { paymentDueDate: past },
    });

    const result = await markOverdueOrders();
    expect(result.marked).toBeGreaterThanOrEqual(1);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    expect(order.status).toBe('OVERDUE');

    const log = await prisma.orderStatusLog.findFirstOrThrow({
      where: { orderId: context.orderId, toStatus: 'OVERDUE' },
    });
    expect(log.fromStatus).toBe('AWAITING_PAYMENT');
  });

  it('overdue_order_can_still_be_paid', async () => {
    const context = await awaitingPayment(3, 1);
    const past = new Date();
    past.setDate(past.getDate() - 5);
    await prisma.order.update({
      where: { id: context.orderId },
      data: { paymentDueDate: past },
    });
    await markOverdueOrders();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    const paid = await recordPayment({
      orderId: context.orderId,
      storeId: context.store.id,
      userId: context.store.userId,
      amount: order.totalWithVat.toFixed(2),
      method: 'DEFERRED',
      paidAt: new Date().toISOString().slice(0, 10),
    });

    expect(paid.status).toBe('wrong_status');
  });
});

describe('дебиторка поставщика', () => {
  it('receivables_show_unpaid_orders_with_overdue_days', async () => {
    const context = await awaitingPayment(4, 5);
    const past = new Date();
    past.setDate(past.getDate() - 4);
    await prisma.order.update({
      where: { id: context.orderId },
      data: { paymentDueDate: past },
    });
    await markOverdueOrders();

    const report = await getReceivables(context.supplier.id);

    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]!.daysOverdue).toBe(4);
    expect(report.total).toBe(report.overdueTotal);
  });

  it('receivables_of_another_supplier_are_not_included', async () => {
    const first = await awaitingPayment(5);
    const second = await awaitingPayment(6);

    const report = await getReceivables(first.supplier.id);
    const orderIds = report.rows.map((row) => row.orderId);

    expect(orderIds).toContain(first.orderId);
    expect(orderIds).not.toContain(second.orderId);
  });
});

describe('акт сверки', () => {
  it('settlement_balances_orders_against_payments', async () => {
    const context = await awaitingPayment(7);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });

    await recordPayment({
      orderId: context.orderId,
      storeId: context.store.id,
      userId: context.store.userId,
      amount: order.totalWithVat.toFixed(2),
      method: 'ON_DELIVERY',
      paidAt: new Date().toISOString().slice(0, 10),
      reference: 'ПП-900',
    });

    const from = new Date();
    from.setMonth(from.getMonth() - 1);
    const settlement = await getSettlement(
      context.supplier.id,
      context.store.id,
      from,
      new Date(Date.now() + 86_400_000),
    );

    expect(settlement.debit).toBe(order.totalWithVat.toFixed(2));
    expect(settlement.credit).toBe(order.totalWithVat.toFixed(2));
    // Оплачено полностью — остаток нулевой.
    expect(settlement.balance).toBe('0.00');
    expect(settlement.rows.length).toBe(2);
  });

  it('settlement_covers_only_requested_period', async () => {
    const context = await awaitingPayment(8);

    const future = new Date();
    future.setMonth(future.getMonth() + 1);
    const later = new Date(future);
    later.setMonth(later.getMonth() + 1);

    const settlement = await getSettlement(context.supplier.id, context.store.id, future, later);
    expect(settlement.rows).toHaveLength(0);
    expect(settlement.balance).toBe('0.00');
  });
});
