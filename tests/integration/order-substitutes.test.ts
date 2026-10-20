import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { orderFixture } from '../helpers/order-fixture';
import { createOfferManually } from '@/lib/catalog/manual';
import { confirmOrder, respondToChanges } from '@/lib/orders/workflow';

const prisma = createTestPrisma();

const fixture = (index: number) =>
  orderFixture(prisma, {
    index,
    phones: ['7747', '7748'],
    binBase: 600,
    productBase: 310000,
    upTo: 'SENT',
  });

function ean13(base: string) {
  const digits = base.split('').map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
}

/** Второй товар того же поставщика — кандидат на замену. */
async function secondOffer(supplierId: string, base: string) {
  const created = await createOfferManually(supplierId, {
    barcode: ean13(base),
    nameRu: 'Замена',
    nameKk: 'Ауыстыру',
    unitCode: 'pcs',
    vatCode: 'vat-16',
    priceWithoutVat: '50',
    packSize: '1',
    minBatch: '1',
    stock: '100',
  });
  if (created.status !== 'ok') throw new Error(created.status);
  return created.offerId;
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('нет в наличии и замена (раздел 3.4 ТЗ)', () => {
  it('supplier_offers_substitute_and_store_agrees', async () => {
    const context = await fixture(1);
    const substituteId = await secondOffer(context.supplierId, '487000531001');
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: context.orderId } });

    const result = await confirmOrder(context.orderId, context.supplierId, context.supplierUserId, [
      {
        orderItemId: item.id,
        quantityConfirmed: '0',
        substituteOfferId: substituteId,
        substituteQuantity: '4',
      },
    ]);
    // Исходная позиция снята, замена 4 × 58.00 (50 + НДС 16%) ждёт согласия магазина.
    expect(result).toEqual({ status: 'ok', orderStatus: 'CHANGED_BY_SUPPLIER', total: '232.00' });

    const substitute = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: context.orderId, substituteForId: item.id },
    });
    expect(substitute.offerId).toBe(substituteId);
    expect(substitute.quantityConfirmed?.toFixed(3)).toBe('4.000');

    expect(
      await respondToChanges(context.orderId, context.storeId, context.storeUserId, true),
    ).toEqual({ status: 'ok', orderStatus: 'ACCEPTED' });
  });

  it('substitute_must_be_own_new_offer_with_positive_quantity', async () => {
    const context = await fixture(2);
    const stranger = await fixture(3);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId: context.orderId } });
    const confirm = (substituteOfferId: string, substituteQuantity = '1') =>
      confirmOrder(context.orderId, context.supplierId, context.supplierUserId, [
        { orderItemId: item.id, quantityConfirmed: '0', substituteOfferId, substituteQuantity },
      ]);
    const invalid = { status: 'invalid_substitute', orderItemId: item.id };

    // Правило 4: чужое предложение подставить нельзя.
    expect(await confirm(stranger.offerId)).toEqual(invalid);
    // То, что уже есть в заявке, заменой не считается.
    expect(await confirm(context.offerId)).toEqual(invalid);
    const own = await secondOffer(context.supplierId, '487000531002');
    expect(await confirm(own, '0')).toEqual(invalid);
    expect(await confirm(own, '1.2345')).toEqual(invalid);

    // Заявка не изменилась.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    expect(order.status).toBe('SENT');
    expect(await prisma.orderItem.count({ where: { orderId: context.orderId } })).toBe(1);
  });
});
