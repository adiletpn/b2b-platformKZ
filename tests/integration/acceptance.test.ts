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
import { documentHtml } from '@/lib/documents/templates';
import type { DocumentPayload } from '@/lib/documents/payload';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

/** Готовит заявку, доведённую до нужного статуса, с накладной при необходимости. */
async function scenario(index: number, options: { withDocuments?: boolean } = {}) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7709${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7710${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(100 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(101 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 4' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  // Реквизиты для счёта (раздел 6.1 демо-ТЗ).
  await prisma.company.update({
    where: { id: supplier.companyId },
    data: { iik: 'KZ123456789012345678', bik: 'HSBKKZKX', bankName: 'Тестовый банк' },
  });

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(60000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 10 }),
        validRow(60500 + index, { priceWithoutVat: '250.00', packSize: 1, minBatch: 4 }),
      ]),
    ),
  );

  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: store.companyId },
  });
  const offers = await prisma.supplierOffer.findMany({
    where: { supplierId: supplier.companyId },
    orderBy: { priceWithoutVat: 'asc' },
  });
  for (const offer of offers) {
    await recordSwipe(store.companyId, location.id, offer.id, 'LIKE');
  }

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

  if (options.withDocuments) {
    await createWaybillAndInvoice(orderId, supplier.companyId);
  }

  for (const status of ['PICKING', 'SHIPPED', 'DELIVERED'] as const) {
    await changeStatus(orderId, supplier.companyId, supplierUser.id, status);
  }

  return {
    orderId,
    order,
    locationId: location.id,
    supplier: { id: supplier.companyId, userId: supplierUser.id },
    store: { id: store.companyId, userId: storeUser.id },
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.notification.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.numberSequence.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('накладная и счёт', () => {
  it('waybill_and_invoice_are_created_in_one_click', async () => {
    const context = await scenario(1);
    await prisma.order.update({ where: { id: context.orderId }, data: { status: 'ACCEPTED' } });

    const result = await createWaybillAndInvoice(context.orderId, context.supplier.id);

    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(result.documents.map((document) => document.type).sort()).toEqual([
      'INVOICE',
      'WAYBILL',
    ]);
    const year = new Date().getFullYear();
    expect(result.documents.find((d) => d.type === 'WAYBILL')!.number).toBe(`З-2-${year}-000001`);
  });

  it('waybill_vat_matches_sixteen_percent_from_reference', async () => {
    const context = await scenario(2);
    await prisma.order.update({ where: { id: context.orderId }, data: { status: 'ACCEPTED' } });
    await createWaybillAndInvoice(context.orderId, context.supplier.id);

    const waybill = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'WAYBILL' },
    });

    // Ставка 16% взята из справочника БД, а не из кода.
    const net = new Decimal(waybill.totalWithoutVat.toString());
    const vat = new Decimal(waybill.vatAmount.toString());
    const gross = new Decimal(waybill.totalWithVat.toString());
    expect(net.plus(vat).toFixed(2)).toBe(gross.toFixed(2));
    expect(vat.div(net).times(100).toDecimalPlaces(0).toString()).toBe('16');
  });

  it('waybill_html_renders_in_russian_and_kazakh', async () => {
    const context = await scenario(3);
    await prisma.order.update({ where: { id: context.orderId }, data: { status: 'ACCEPTED' } });
    await createWaybillAndInvoice(context.orderId, context.supplier.id);

    const waybill = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'WAYBILL' },
    });
    const payload = waybill.payload as unknown as DocumentPayload;

    expect(documentHtml('WAYBILL', payload, 'ru')).toContain(
      'Накладная на отпуск запасов на сторону',
    );
    expect(documentHtml('WAYBILL', payload, 'ru')).toContain('Форма З-2');
    expect(documentHtml('WAYBILL', payload, 'kk')).toContain('З-2 нысаны');
    expect(documentHtml('INVOICE', payload, 'kk')).toContain('Төлеуге арналған шот');
  });

  it('invoice_contains_iban_and_bik', async () => {
    const context = await scenario(4);
    await prisma.order.update({ where: { id: context.orderId }, data: { status: 'ACCEPTED' } });
    await createWaybillAndInvoice(context.orderId, context.supplier.id);

    const invoice = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'INVOICE' },
    });
    const html = documentHtml('INVOICE', invoice.payload as unknown as DocumentPayload, 'ru');

    expect(html).toContain('KZ123456789012345678');
    expect(html).toContain('HSBKKZKX');
  });

  it('documents_cannot_be_created_twice', async () => {
    const context = await scenario(5);
    await prisma.order.update({ where: { id: context.orderId }, data: { status: 'ACCEPTED' } });

    await createWaybillAndInvoice(context.orderId, context.supplier.id);
    const second = await createWaybillAndInvoice(context.orderId, context.supplier.id);

    expect(second.status).toBe('already_exists');
    expect(await prisma.document.count({ where: { orderId: context.orderId } })).toBe(2);
  });

  it('documents_of_another_company_are_not_created', async () => {
    const context = await scenario(6);
    const result = await createWaybillAndInvoice(context.orderId, context.store.id);
    expect(result.status).toBe('not_found');
  });
});

describe('приёмка', () => {
  it('acceptance_without_discrepancy_closes_order_cleanly', async () => {
    const context = await scenario(7, { withDocuments: true });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: context.orderId },
      include: { items: true },
    });

    const result = await acceptDelivery(
      context.orderId,
      context.store.id,
      context.store.userId,
      order.items.map((item) => ({
        orderItemId: item.id,
        quantityAccepted: item.quantityConfirmed!.toFixed(3),
      })),
    );

    expect(result).toMatchObject({ status: 'ok', orderStatus: 'ACCEPTED_BY_STORE' });
    if (result.status !== 'ok') return;
    expect(result.discrepancyActId).toBeNull();
  });

  it('acceptance_with_defect_creates_act_and_recalculates_total', async () => {
    const context = await scenario(8, { withDocuments: true });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: context.orderId },
      include: { items: true },
    });
    const first = order.items[0]!;
    const shipped = new Decimal(first.quantityConfirmed!.toString());
    const accepted = shipped.minus(2);

    const result = await acceptDelivery(context.orderId, context.store.id, context.store.userId, [
      {
        orderItemId: first.id,
        quantityAccepted: accepted.toFixed(3),
        quantityDefective: '2',
      },
    ]);

    expect(result).toMatchObject({ status: 'ok', orderStatus: 'ACCEPTED_WITH_DISCREPANCY' });
    if (result.status !== 'ok') return;
    expect(result.discrepancyActId).not.toBeNull();

    const act = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'DISCREPANCY_ACT' },
    });

    // Сумма к оплате уменьшилась ровно на стоимость непринятых двух единиц.
    const price = new Decimal(first.priceWithVat.toString());
    const before = new Decimal(order.totalWithVat.toString());
    const expected = before.minus(price.times(2)).toFixed(2);
    expect(result.total).toBe(expected);
    expect(act.totalWithVat.toFixed(2)).toBe(expected);

    const updated = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    expect(updated.totalWithVat.toFixed(2)).toBe(expected);
  });

  it('acceptance_records_defect_and_mismatch_quantities', async () => {
    const context = await scenario(9, { withDocuments: true });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: context.orderId },
      include: { items: true },
    });
    const first = order.items[0]!;
    const shipped = new Decimal(first.quantityConfirmed!.toString());

    await acceptDelivery(context.orderId, context.store.id, context.store.userId, [
      {
        orderItemId: first.id,
        quantityAccepted: shipped.minus(3).toFixed(3),
        quantityDefective: '2',
        quantityMismatch: '1',
      },
    ]);

    const item = await prisma.orderItem.findUniqueOrThrow({ where: { id: first.id } });
    expect(item.quantityDefective!.toFixed(3)).toBe('2.000');
    expect(item.quantityMismatch!.toFixed(3)).toBe('1.000');
    expect(item.quantityAccepted!.toFixed(3)).toBe(shipped.minus(3).toFixed(3));
  });

  it('store_stock_grows_after_acceptance', async () => {
    const context = await scenario(10, { withDocuments: true });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: context.orderId },
      include: { items: { include: { offer: true } } },
    });

    expect(await prisma.stockBalance.count({ where: { locationId: context.locationId } })).toBe(0);

    await acceptDelivery(
      context.orderId,
      context.store.id,
      context.store.userId,
      order.items.map((item) => ({
        orderItemId: item.id,
        quantityAccepted: item.quantityConfirmed!.toFixed(3),
      })),
    );

    const balances = await prisma.stockBalance.findMany({
      where: { locationId: context.locationId },
    });
    expect(balances).toHaveLength(order.items.length);

    for (const item of order.items) {
      const balance = balances.find((row) => row.productId === item.offer.productId)!;
      expect(balance.quantity.toFixed(3)).toBe(item.quantityConfirmed!.toFixed(3));
      // Закупочная цена из накладной — без НДС.
      expect(balance.averageCost.toFixed(2)).toBe(item.priceWithoutVat.toFixed(2));
    }
  });

  it('stock_grows_only_by_accepted_quantity_not_shipped', async () => {
    const context = await scenario(11, { withDocuments: true });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: context.orderId },
      include: { items: { include: { offer: true } } },
    });
    const first = order.items[0]!;
    const accepted = new Decimal(first.quantityConfirmed!.toString()).minus(4);

    await acceptDelivery(context.orderId, context.store.id, context.store.userId, [
      { orderItemId: first.id, quantityAccepted: accepted.toFixed(3), quantityDefective: '4' },
    ]);

    const balance = await prisma.stockBalance.findFirstOrThrow({
      where: { locationId: context.locationId, productId: first.offer.productId },
    });
    expect(balance.quantity.toFixed(3)).toBe(accepted.toFixed(3));
  });

  it('every_stock_change_has_a_movement_document', async () => {
    const context = await scenario(12, { withDocuments: true });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: context.orderId },
      include: { items: true },
    });

    await acceptDelivery(
      context.orderId,
      context.store.id,
      context.store.userId,
      order.items.map((item) => ({
        orderItemId: item.id,
        quantityAccepted: item.quantityConfirmed!.toFixed(3),
      })),
    );

    // Правило 3: остаток меняется только документом движения.
    const movements = await prisma.stockMovement.findMany({
      where: { locationId: context.locationId },
    });
    expect(movements).toHaveLength(order.items.length);
    for (const movement of movements) {
      expect(movement.type).toBe('RECEIPT');
      expect(movement.documentId).not.toBeNull();
    }
  });

  it('acceptance_requires_waybill', async () => {
    const context = await scenario(13);
    const result = await acceptDelivery(
      context.orderId,
      context.store.id,
      context.store.userId,
      [],
    );
    expect(result.status).toBe('no_waybill');
  });

  it('acceptance_rejects_more_than_shipped', async () => {
    const context = await scenario(14, { withDocuments: true });
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: context.orderId },
      include: { items: true },
    });
    const first = order.items[0]!;

    const result = await acceptDelivery(context.orderId, context.store.id, context.store.userId, [
      {
        orderItemId: first.id,
        quantityAccepted: new Decimal(first.quantityConfirmed!.toString()).plus(1).toFixed(3),
      },
    ]);

    expect(result.status).toBe('invalid_quantity');
    expect(await prisma.stockMovement.count({ where: { locationId: context.locationId } })).toBe(0);
  });

  it('acceptance_is_not_available_to_another_company', async () => {
    const context = await scenario(15, { withDocuments: true });
    const result = await acceptDelivery(
      context.orderId,
      context.supplier.id,
      context.supplier.userId,
      [],
    );
    expect(result.status).toBe('not_found');
  });
});
