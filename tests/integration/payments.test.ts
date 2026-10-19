import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
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
import { saveRequisites } from '@/lib/payments/requisites';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();
const VALID_IIK = 'KZ07HSBK123456789012';

/** Заявка, доведённая до «Ожидает оплаты». */
async function paidReadyOrder(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7713${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7714${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(150 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(151 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 8' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await saveRequisites(supplier.companyId, {
    iik: VALID_IIK,
    bik: 'HSBKKZKX',
    bankName: 'Тестовый банк',
  });

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(80000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 5 }),
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

  const checkoutResult = await checkout({
    storeId: store.companyId,
    locationId: location.id,
    cityId: taraz.id,
    userId: storeUser.id,
  });
  if (checkoutResult.status !== 'created') throw new Error(checkoutResult.status);
  const orderId = checkoutResult.orders[0]!.id;

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

  const ready = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  return {
    orderId,
    total: ready.totalWithVat.toFixed(2),
    supplier: { id: supplier.companyId, userId: supplierUser.id },
    store: { id: store.companyId, userId: storeUser.id },
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.payment.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('реквизиты компании', () => {
  it('requisites_are_saved_after_iban_validation', async () => {
    const user = await prisma.user.create({ data: { phone: '+77150000001' } });
    const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
    const company = await registerCompany({
      userId: user.id,
      bin: testPoolBin(190),
      type: 'SUPPLIER',
      deliveryCityIds: [taraz.id],
      consentAccepted: true,
    });
    if (company.status !== 'created') throw new Error(company.status);

    expect(
      await saveRequisites(company.companyId, {
        iik: VALID_IIK,
        bik: 'HSBKKZKX',
        bankName: 'Тестовый банк',
      }),
    ).toEqual({ status: 'ok' });

    const saved = await prisma.company.findUniqueOrThrow({ where: { id: company.companyId } });
    expect(saved.iik).toBe(VALID_IIK);
    expect(saved.bik).toBe('HSBKKZKX');
  });

  it('requisites_reject_invalid_iban_and_bik', async () => {
    const user = await prisma.user.create({ data: { phone: '+77150000002' } });
    const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
    const company = await registerCompany({
      userId: user.id,
      bin: testPoolBin(191),
      type: 'SUPPLIER',
      deliveryCityIds: [taraz.id],
      consentAccepted: true,
    });
    if (company.status !== 'created') throw new Error(company.status);

    expect(
      await saveRequisites(company.companyId, {
        iik: 'KZ08HSBK123456789012',
        bik: 'HSBKKZKX',
        bankName: 'Банк',
      }),
    ).toEqual({ status: 'invalid_iik' });

    expect(
      await saveRequisites(company.companyId, {
        iik: VALID_IIK,
        bik: 'HSBK',
        bankName: 'Банк',
      }),
    ).toEqual({ status: 'invalid_bik' });
  });
});

describe('оплата', () => {
  it('manual_payment_marks_order_as_paid', async () => {
    const context = await paidReadyOrder(1);

    const result = await recordPayment({
      orderId: context.orderId,
      storeId: context.store.id,
      userId: context.store.userId,
      amount: context.total,
      method: 'ON_DELIVERY',
      paidAt: '2026-10-19',
      reference: 'ПП-125',
    });

    expect(result.status).toBe('ok');
    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    expect(order.status).toBe('PAID');

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: context.orderId } });
    expect(payment.amount.toFixed(2)).toBe(context.total);
    expect(payment.reference).toBe('ПП-125');
    expect(payment.documentId).not.toBeNull();
  });

  it('payment_amount_must_match_order_total', async () => {
    const context = await paidReadyOrder(2);
    const wrong = new Decimal(context.total).minus(1).toFixed(2);

    const result = await recordPayment({
      orderId: context.orderId,
      storeId: context.store.id,
      userId: context.store.userId,
      amount: wrong,
      method: 'ON_DELIVERY',
      paidAt: '2026-10-19',
    });

    expect(result.status).toBe('invalid_amount');
    expect(await prisma.payment.count()).toBe(0);
  });

  it('payment_is_rejected_before_acceptance', async () => {
    const context = await paidReadyOrder(3);
    await prisma.order.update({ where: { id: context.orderId }, data: { status: 'SHIPPED' } });

    const result = await recordPayment({
      orderId: context.orderId,
      storeId: context.store.id,
      userId: context.store.userId,
      amount: context.total,
      method: 'ON_DELIVERY',
      paidAt: '2026-10-19',
    });

    expect(result.status).toBe('wrong_status');
  });

  it('payment_of_another_company_is_not_possible', async () => {
    const context = await paidReadyOrder(4);

    const result = await recordPayment({
      orderId: context.orderId,
      storeId: context.supplier.id,
      userId: context.supplier.userId,
      amount: context.total,
      method: 'ON_DELIVERY',
      paidAt: '2026-10-19',
    });

    expect(result.status).toBe('not_found');
  });

  it('supplier_is_notified_about_payment', async () => {
    const context = await paidReadyOrder(5);
    await prisma.notification.deleteMany();

    await recordPayment({
      orderId: context.orderId,
      storeId: context.store.id,
      userId: context.store.userId,
      amount: context.total,
      method: 'PREPAY',
      paidAt: '2026-10-19',
    });

    const notifications = await prisma.notification.findMany({
      where: { companyId: context.supplier.id },
    });
    expect(notifications).toHaveLength(1);
  });

  it('paid_order_can_be_closed', async () => {
    const context = await paidReadyOrder(6);
    await recordPayment({
      orderId: context.orderId,
      storeId: context.store.id,
      userId: context.store.userId,
      amount: context.total,
      method: 'ON_DELIVERY',
      paidAt: '2026-10-19',
    });

    const closed = await changeStatus(
      context.orderId,
      context.store.id,
      context.store.userId,
      'CLOSED',
    );
    expect(closed).toMatchObject({ status: 'ok', orderStatus: 'CLOSED' });
  });
});
