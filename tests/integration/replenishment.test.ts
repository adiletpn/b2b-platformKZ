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
import { writeOffStock } from '@/lib/stock/documents';
import { buildReplenishmentDraft, getReplenishment, setMinimum } from '@/lib/stock/replenishment';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

/** Магазин, который уже покупал товар у поставщика: есть остаток и история закупки. */
async function storeWithHistory(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7773${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7774${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(860 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(861 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 140' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(220000 + index, { priceWithoutVat: '100.00', packSize: 6, minBatch: 12 }),
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

  const balance = await prisma.stockBalance.findFirstOrThrow({
    where: { locationId: location.id },
  });

  return {
    companyId: store.companyId,
    userId: storeUser.id,
    locationId: location.id,
    productId: balance.productId,
    offerId: offer.id,
    supplierId: supplier.companyId,
    quantity: new Decimal(balance.quantity.toString()),
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.auditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('минимальный остаток', () => {
  it('minimum_is_saved_with_three_decimals', async () => {
    const store = await storeWithHistory(1);

    expect(await setMinimum(store.companyId, store.locationId, store.productId, '10,5')).toEqual({
      status: 'ok',
    });

    const balance = await prisma.stockBalance.findFirstOrThrow({
      where: { locationId: store.locationId, productId: store.productId },
    });
    expect(balance.minQuantity?.toFixed(3)).toBe('10.500');
  });

  it('negative_minimum_and_foreign_location_are_refused', async () => {
    const store = await storeWithHistory(2);
    const other = await storeWithHistory(3);

    expect(await setMinimum(store.companyId, store.locationId, store.productId, '-1')).toEqual({
      status: 'invalid_quantity',
    });

    // Правило 4: чужая точка недоступна.
    expect(await setMinimum(store.companyId, other.locationId, other.productId, '5')).toEqual({
      status: 'not_found',
    });
  });

  it('empty_value_removes_the_control', async () => {
    const store = await storeWithHistory(4);
    await setMinimum(store.companyId, store.locationId, store.productId, '5');

    expect(await setMinimum(store.companyId, store.locationId, store.productId, '')).toEqual({
      status: 'ok',
    });
    const balance = await prisma.stockBalance.findFirstOrThrow({
      where: { locationId: store.locationId, productId: store.productId },
    });
    expect(balance.minQuantity).toBeNull();
  });
});

describe('автозаказ по минимуму', () => {
  it('product_below_minimum_is_suggested_with_last_supplier', async () => {
    const store = await storeWithHistory(5);
    // Остаток 12, списываем 10 — остаётся 2 при минимуме 20.
    await writeOffStock(store.companyId, store.userId, {
      locationId: store.locationId,
      reason: 'DAMAGE',
      lines: [{ productId: store.productId, quantity: '10' }],
    });
    await setMinimum(store.companyId, store.locationId, store.productId, '20');

    const rows = await getReplenishment(store.companyId, store.locationId);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.supplierId).toBe(store.supplierId);
    expect(rows[0]!.quantity).toBe('2.000');
    // Не хватает 18, кратность упаковки 6 — предлагаем 18.
    expect(rows[0]!.suggested).toBe('18.000');
  });

  it('suggestion_is_not_less_than_minimal_batch', async () => {
    const store = await storeWithHistory(6);
    await writeOffStock(store.companyId, store.userId, {
      locationId: store.locationId,
      reason: 'BREAKAGE',
      lines: [{ productId: store.productId, quantity: '1' }],
    });
    await setMinimum(store.companyId, store.locationId, store.productId, '12');

    const rows = await getReplenishment(store.companyId, store.locationId);
    // Не хватает одной штуки, но минимальная партия поставщика — 12.
    expect(rows[0]!.suggested).toBe('12.000');
  });

  it('stock_above_minimum_is_not_suggested', async () => {
    const store = await storeWithHistory(7);
    await setMinimum(store.companyId, store.locationId, store.productId, '5');

    expect(await getReplenishment(store.companyId, store.locationId)).toEqual([]);
  });

  it('draft_puts_suggestions_into_cart', async () => {
    const store = await storeWithHistory(8);
    await writeOffStock(store.companyId, store.userId, {
      locationId: store.locationId,
      reason: 'EXPIRED',
      lines: [{ productId: store.productId, quantity: '10' }],
    });
    await setMinimum(store.companyId, store.locationId, store.productId, '20');

    const result = await buildReplenishmentDraft(store.companyId, store.userId, store.locationId);

    expect(result).toEqual({ status: 'ok', added: 1 });
    const cart = await prisma.cart.findUniqueOrThrow({
      where: { locationId: store.locationId },
      include: { items: true },
    });
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]!.offerId).toBe(store.offerId);
    expect(cart.items[0]!.quantity.toFixed(3)).toBe('18.000');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: store.companyId, action: 'replenishment_drafted' },
    });
    expect(audit.entityId).toBe(store.locationId);
  });

  it('nothing_to_order_when_everything_is_above_minimum', async () => {
    const store = await storeWithHistory(9);
    await setMinimum(store.companyId, store.locationId, store.productId, '1');

    expect(await buildReplenishmentDraft(store.companyId, store.userId, store.locationId)).toEqual({
      status: 'nothing_to_order',
    });
  });

  it('replenishment_of_another_company_location_is_empty', async () => {
    const store = await storeWithHistory(10);
    const other = await storeWithHistory(11);
    await setMinimum(other.companyId, other.locationId, other.productId, '999');

    // Правило 4: чужая точка не отдаёт данные.
    expect(await getReplenishment(store.companyId, other.locationId)).toEqual([]);
    expect(await buildReplenishmentDraft(store.companyId, store.userId, other.locationId)).toEqual({
      status: 'not_found',
    });
  });
});
