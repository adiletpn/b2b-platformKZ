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
import { getProductLedger, stocktake, transferStock, writeOffStock } from '@/lib/stock/documents';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

/** Магазин с товаром на остатках: приход сделан приёмкой по накладной. */
async function storeWithStock(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7771${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7772${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(820 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(821 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 130' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(210000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 10 }),
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

  // Вторая точка той же компании: на неё перемещаем товар.
  const second = await prisma.location.create({
    data: {
      companyId: store.companyId,
      cityId: taraz.id,
      type: 'WAREHOUSE',
      address: 'ул. Складская, 3',
    },
  });

  const balance = await prisma.stockBalance.findFirstOrThrow({
    where: { locationId: location.id },
  });

  return {
    companyId: store.companyId,
    userId: storeUser.id,
    locationId: location.id,
    warehouseId: second.id,
    productId: balance.productId,
    quantity: new Decimal(balance.quantity.toString()),
    cost: new Decimal(balance.averageCost.toString()),
  };
}

async function balanceOf(locationId: string, productId: string) {
  const balance = await prisma.stockBalance.findUnique({
    where: { locationId_productId: { locationId, productId } },
  });
  return {
    quantity: new Decimal(balance?.quantity.toString() ?? '0'),
    cost: new Decimal(balance?.averageCost.toString() ?? '0'),
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.auditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('перемещение между точками', () => {
  it('transfer_moves_quantity_and_keeps_cost', async () => {
    const store = await storeWithStock(1);

    const result = await transferStock(store.companyId, store.userId, {
      fromLocationId: store.locationId,
      toLocationId: store.warehouseId,
      lines: [{ productId: store.productId, quantity: '4' }],
      comment: 'на витрину',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.number.startsWith('ПЕРЕМ-')).toBe(true);

    const from = await balanceOf(store.locationId, store.productId);
    const to = await balanceOf(store.warehouseId, store.productId);
    expect(from.quantity.toFixed(3)).toBe(store.quantity.minus(4).toFixed(3));
    expect(to.quantity.toFixed(3)).toBe('4.000');
    // Себестоимость переезжает вместе с товаром.
    expect(to.cost.toFixed(2)).toBe(store.cost.toFixed(2));

    // Правило 3: остаток изменён движениями, по одному на каждую сторону.
    const movements = await prisma.stockMovement.findMany({
      where: { stockDocumentId: result.documentId },
    });
    expect(movements).toHaveLength(2);
    expect(movements.some((movement) => movement.quantity.toFixed(3) === '-4.000')).toBe(true);
  });

  it('transfer_more_than_stock_is_refused', async () => {
    const store = await storeWithStock(2);

    const result = await transferStock(store.companyId, store.userId, {
      fromLocationId: store.locationId,
      toLocationId: store.warehouseId,
      lines: [{ productId: store.productId, quantity: '999' }],
    });

    expect(result).toEqual({ status: 'not_enough_stock', productId: store.productId });
    expect(await prisma.stockDocument.count()).toBe(0);
    const from = await balanceOf(store.locationId, store.productId);
    expect(from.quantity.toFixed(3)).toBe(store.quantity.toFixed(3));
  });

  it('transfer_to_the_same_or_foreign_location_is_refused', async () => {
    const store = await storeWithStock(3);
    const other = await storeWithStock(4);

    expect(
      await transferStock(store.companyId, store.userId, {
        fromLocationId: store.locationId,
        toLocationId: store.locationId,
        lines: [{ productId: store.productId, quantity: '1' }],
      }),
    ).toEqual({ status: 'same_location' });

    // Правило 4: точка чужой компании недоступна.
    expect(
      await transferStock(store.companyId, store.userId, {
        fromLocationId: store.locationId,
        toLocationId: other.locationId,
        lines: [{ productId: store.productId, quantity: '1' }],
      }),
    ).toEqual({ status: 'not_found' });
  });
});

describe('списание', () => {
  it('write_off_reduces_stock_and_keeps_reason', async () => {
    const store = await storeWithStock(5);

    const result = await writeOffStock(store.companyId, store.userId, {
      locationId: store.locationId,
      reason: 'EXPIRED',
      lines: [{ productId: store.productId, quantity: '2.5' }],
      comment: 'истёк срок',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.number.startsWith('СПИС-')).toBe(true);

    const document = await prisma.stockDocument.findUniqueOrThrow({
      where: { id: result.documentId },
      include: { lines: true },
    });
    expect(document.reason).toBe('EXPIRED');
    // Правило 2: количества до трёх знаков.
    expect(document.lines[0]!.quantity.toFixed(3)).toBe('2.500');

    const balance = await balanceOf(store.locationId, store.productId);
    expect(balance.quantity.toFixed(3)).toBe(store.quantity.minus(2.5).toFixed(3));
    // Расход не меняет среднюю себестоимость.
    expect(balance.cost.toFixed(2)).toBe(store.cost.toFixed(2));
  });

  it('write_off_without_lines_or_with_negative_quantity_is_refused', async () => {
    const store = await storeWithStock(6);

    expect(
      await writeOffStock(store.companyId, store.userId, {
        locationId: store.locationId,
        reason: 'DAMAGE',
        lines: [],
      }),
    ).toEqual({ status: 'empty_lines' });

    expect(
      await writeOffStock(store.companyId, store.userId, {
        locationId: store.locationId,
        reason: 'DAMAGE',
        lines: [{ productId: store.productId, quantity: '-1' }],
      }),
    ).toEqual({ status: 'invalid_quantity' });
  });
});

describe('инвентаризация', () => {
  it('stocktake_writes_down_expected_and_actual', async () => {
    const store = await storeWithStock(7);
    const actual = store.quantity.minus(1);

    const result = await stocktake(store.companyId, store.userId, {
      locationId: store.locationId,
      lines: [{ productId: store.productId, actualQuantity: actual.toFixed(3) }],
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.number.startsWith('ИНВ-')).toBe(true);

    const document = await prisma.stockDocument.findUniqueOrThrow({
      where: { id: result.documentId },
      include: { lines: true },
    });
    const line = document.lines[0]!;
    expect(line.expected?.toFixed(3)).toBe(store.quantity.toFixed(3));
    expect(line.quantity.toFixed(3)).toBe(actual.toFixed(3));

    // Расхождение выправлено движением, а не правкой остатка (правило 3).
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockDocumentId: result.documentId },
    });
    expect(movement.type).toBe('INVENTORY');
    expect(movement.quantity.toFixed(3)).toBe('-1.000');

    const balance = await balanceOf(store.locationId, store.productId);
    expect(balance.quantity.toFixed(3)).toBe(actual.toFixed(3));
  });

  it('stocktake_without_difference_creates_no_movement', async () => {
    const store = await storeWithStock(8);

    const result = await stocktake(store.companyId, store.userId, {
      locationId: store.locationId,
      lines: [{ productId: store.productId, actualQuantity: store.quantity.toFixed(3) }],
    });
    if (result.status !== 'ok') throw new Error(result.status);

    expect(
      await prisma.stockMovement.count({ where: { stockDocumentId: result.documentId } }),
    ).toBe(0);
    // Опись всё равно сохраняется: она подтверждает пересчёт.
    const document = await prisma.stockDocument.findUniqueOrThrow({
      where: { id: result.documentId },
      include: { lines: true },
    });
    expect(document.lines).toHaveLength(1);
  });

  it('surplus_increases_stock', async () => {
    const store = await storeWithStock(9);
    const actual = store.quantity.plus(3);

    await stocktake(store.companyId, store.userId, {
      locationId: store.locationId,
      lines: [{ productId: store.productId, actualQuantity: actual.toFixed(3) }],
    });

    const balance = await balanceOf(store.locationId, store.productId);
    expect(balance.quantity.toFixed(3)).toBe(actual.toFixed(3));
    // Излишек приходуется по текущей себестоимости.
    expect(balance.cost.toFixed(2)).toBe(store.cost.toFixed(2));
  });
});

describe('журнал движения товара', () => {
  it('ledger_shows_receipt_transfer_and_write_off', async () => {
    const store = await storeWithStock(10);
    await transferStock(store.companyId, store.userId, {
      fromLocationId: store.locationId,
      toLocationId: store.warehouseId,
      lines: [{ productId: store.productId, quantity: '2' }],
    });
    await writeOffStock(store.companyId, store.userId, {
      locationId: store.locationId,
      reason: 'BREAKAGE',
      lines: [{ productId: store.productId, quantity: '1' }],
    });

    const ledger = await getProductLedger(store.companyId, store.productId);

    // Приход по накладной, два движения перемещения и списание.
    expect(ledger).toHaveLength(4);
    expect(ledger[0]!.type).toBe('WRITE_OFF');
    expect(ledger.every((entry) => entry.documentNumber !== null)).toBe(true);

    const onlyShop = await getProductLedger(store.companyId, store.productId, store.locationId);
    expect(onlyShop).toHaveLength(3);
  });

  it('ledger_of_another_company_is_empty', async () => {
    const store = await storeWithStock(11);
    const other = await storeWithStock(12);

    // Правило 4: чужие движения не видны.
    expect(await getProductLedger(other.companyId, store.productId)).toEqual([]);
  });
});
