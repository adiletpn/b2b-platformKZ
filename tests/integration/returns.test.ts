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
import { createReturn, decideDiscrepancyAct } from '@/lib/documents/returns';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

/** Принятая заявка: товар на остатках магазина, можно возвращать. */
async function acceptedOrder(index: number, options: { withDefect?: boolean } = {}) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7780${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7781${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(550 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(551 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 50' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(160000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 10 }),
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

  const item = order.items[0]!;
  const ordered = new Decimal(item.quantityOrdered.toString());
  await acceptDelivery(orderId, store.companyId, storeUser.id, [
    {
      orderItemId: item.id,
      quantityAccepted: options.withDefect ? ordered.minus(2).toFixed(3) : ordered.toFixed(3),
      quantityDefective: options.withDefect ? '2' : '0',
    },
  ]);

  return {
    orderId,
    itemId: item.id,
    locationId: location.id,
    productId: offer.productId,
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

describe('возврат товара поставщику', () => {
  it('return_waybill_reduces_store_stock', async () => {
    const context = await acceptedOrder(1);
    const before = await prisma.stockBalance.findFirstOrThrow({
      where: { locationId: context.locationId, productId: context.productId },
    });

    const result = await createReturn(context.orderId, context.store.id, context.store.userId, [
      { orderItemId: context.itemId, quantity: '3' },
    ]);

    expect(result.status).toBe('ok');
    const after = await prisma.stockBalance.findFirstOrThrow({
      where: { locationId: context.locationId, productId: context.productId },
    });
    expect(
      new Decimal(before.quantity.toString()).minus(after.quantity.toString()).toFixed(3),
    ).toBe('3.000');
  });

  it('return_creates_movement_document', async () => {
    const context = await acceptedOrder(2);
    await createReturn(context.orderId, context.store.id, context.store.userId, [
      { orderItemId: context.itemId, quantity: '2' },
    ]);

    // Правило 3: остаток меняется только документом движения.
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { locationId: context.locationId, type: 'ISSUE' },
    });
    expect(movement.documentId).not.toBeNull();
    expect(new Decimal(movement.quantity.toString()).isNegative()).toBe(true);

    const document = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'RETURN_WAYBILL' },
    });
    expect(document.number.startsWith('ВОЗВ-')).toBe(true);
  });

  it('return_cannot_exceed_accepted_quantity', async () => {
    const context = await acceptedOrder(3);
    const result = await createReturn(context.orderId, context.store.id, context.store.userId, [
      { orderItemId: context.itemId, quantity: '999' },
    ]);
    expect(result.status).toBe('invalid_quantity');
    expect(await prisma.document.count({ where: { type: 'RETURN_WAYBILL' } })).toBe(0);
  });

  it('return_of_another_company_is_refused', async () => {
    const context = await acceptedOrder(4);
    const result = await createReturn(
      context.orderId,
      context.supplier.id,
      context.supplier.userId,
      [{ orderItemId: context.itemId, quantity: '1' }],
    );
    expect(result.status).toBe('not_found');
  });
});

describe('решение по акту расхождений', () => {
  it('supplier_confirms_discrepancy_act', async () => {
    const context = await acceptedOrder(5, { withDefect: true });
    const act = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'DISCREPANCY_ACT' },
    });

    const result = await decideDiscrepancyAct(
      act.id,
      context.supplier.id,
      context.supplier.userId,
      true,
    );

    expect(result).toEqual({ status: 'ok', decision: 'CONFIRMED' });
    const saved = await prisma.document.findUniqueOrThrow({ where: { id: act.id } });
    expect(saved.decision).toBe('CONFIRMED');
    expect(saved.decidedAt).not.toBeNull();
  });

  it('dispute_opens_a_dispute_on_the_order', async () => {
    const context = await acceptedOrder(6, { withDefect: true });
    const act = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'DISCREPANCY_ACT' },
    });

    const result = await decideDiscrepancyAct(
      act.id,
      context.supplier.id,
      context.supplier.userId,
      false,
      'товар был целый при отгрузке',
    );

    expect(result).toEqual({ status: 'ok', decision: 'DISPUTED' });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    // Раздел 5.2 ТЗ: спор разбирает администратор платформы.
    expect(order.status).toBe('DISPUTE');
    expect(order.disputeReason).toBe('товар был целый при отгрузке');
  });

  it('dispute_requires_reason_and_single_decision', async () => {
    const context = await acceptedOrder(7, { withDefect: true });
    const act = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'DISCREPANCY_ACT' },
    });

    expect(
      await decideDiscrepancyAct(act.id, context.supplier.id, context.supplier.userId, false, '  '),
    ).toEqual({ status: 'reason_required' });

    await decideDiscrepancyAct(act.id, context.supplier.id, context.supplier.userId, true);
    expect(
      await decideDiscrepancyAct(act.id, context.supplier.id, context.supplier.userId, true),
    ).toEqual({ status: 'already_decided' });
  });

  it('act_of_another_company_cannot_be_decided', async () => {
    const context = await acceptedOrder(8, { withDefect: true });
    const act = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'DISCREPANCY_ACT' },
    });

    expect(
      await decideDiscrepancyAct(act.id, context.store.id, context.store.userId, true),
    ).toEqual({ status: 'not_found' });
  });
});
