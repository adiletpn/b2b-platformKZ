import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { consumeFefo, getExpiring, receiveBatch } from '@/lib/stock/batches';
import { registerCompany } from '@/lib/registration/register-company';
import { createOfferManually } from '@/lib/catalog/manual';
import { writeOffStock, transferStock } from '@/lib/stock/documents';
import { applyBalanceChange } from '@/lib/stock/balance';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

function ean13(base: string) {
  const digits = base.padStart(12, '0').slice(0, 12).split('').map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return `${digits.join('')}${(10 - (sum % 10)) % 10}`;
}

/** Магазин с двумя точками и товаром в справочнике: партии заводим напрямую. */
async function storeWithProduct(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7775${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7776${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(900 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(901 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 150' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  const offer = await createOfferManually(supplier.companyId, {
    barcode: ean13(`48700030000${index}`),
    nameRu: 'Молоко партионное',
    nameKk: 'Партиялық сүт',
    unitCode: 'pcs',
    vatCode: 'vat-16',
    priceWithoutVat: '100',
    packSize: '1',
    minBatch: '1',
    stock: '0',
  });
  if (offer.status !== 'ok') throw new Error(offer.status);
  const saved = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offer.offerId } });

  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: store.companyId },
  });
  const warehouse = await prisma.location.create({
    data: {
      companyId: store.companyId,
      cityId: taraz.id,
      type: 'WAREHOUSE',
      address: 'ул. Складская, 9',
    },
  });

  return {
    companyId: store.companyId,
    userId: storeUser.id,
    locationId: location.id,
    warehouseId: warehouse.id,
    productId: saved.productId,
  };
}

/** Партия плюс остаток: в бою это делает приёмка по накладной. */
async function stock(
  context: { locationId: string; productId: string },
  quantity: string,
  expiresAt: string | null,
  cost = '100.00',
) {
  await prisma.$transaction(async (tx) => {
    await receiveBatch(tx, {
      locationId: context.locationId,
      productId: context.productId,
      quantity: new Decimal(quantity),
      costPrice: new Decimal(cost),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
    });
    await applyBalanceChange(tx, {
      locationId: context.locationId,
      productId: context.productId,
      quantity: new Decimal(quantity),
      costPrice: new Decimal(cost),
    });
  });
}

async function batchesOf(locationId: string) {
  const rows = await prisma.stockBatch.findMany({
    where: { locationId },
    orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }],
  });
  return rows.map((row) => ({
    quantity: row.quantity.toFixed(3),
    expiresAt: row.expiresAt?.toISOString().slice(0, 10) ?? null,
  }));
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('партии и сроки годности', () => {
  it('same_date_and_cost_join_one_batch', async () => {
    const store = await storeWithProduct(1);
    await stock(store, '5', '2026-12-01');
    await stock(store, '3', '2026-12-01');

    expect(await batchesOf(store.locationId)).toEqual([
      { quantity: '8.000', expiresAt: '2026-12-01' },
    ]);
  });

  it('write_off_takes_the_nearest_date_first', async () => {
    const store = await storeWithProduct(2);
    await stock(store, '4', '2026-12-31');
    await stock(store, '6', '2026-11-01');

    await writeOffStock(store.companyId, store.userId, {
      locationId: store.locationId,
      reason: 'EXPIRED',
      lines: [{ productId: store.productId, quantity: '7' }],
    });

    // FEFO: сначала ушла ноябрьская партия целиком, потом часть декабрьской.
    expect(await batchesOf(store.locationId)).toEqual([
      { quantity: '0.000', expiresAt: '2026-11-01' },
      { quantity: '3.000', expiresAt: '2026-12-31' },
    ]);
  });

  it('batch_without_date_goes_last', async () => {
    const store = await storeWithProduct(3);
    await stock(store, '5', null);
    await stock(store, '5', '2027-01-15');

    const consumed = await prisma.$transaction((tx) =>
      consumeFefo(tx, store.locationId, store.productId, new Decimal(6)),
    );

    expect(consumed).not.toBeNull();
    expect(consumed![0]!.expiresAt?.toISOString().slice(0, 10)).toBe('2027-01-15');
    expect(consumed![1]!.expiresAt).toBeNull();
  });

  it('transfer_moves_batches_with_their_dates', async () => {
    const store = await storeWithProduct(4);
    await stock(store, '10', '2026-11-20');

    await transferStock(store.companyId, store.userId, {
      fromLocationId: store.locationId,
      toLocationId: store.warehouseId,
      lines: [{ productId: store.productId, quantity: '4' }],
    });

    expect(await batchesOf(store.warehouseId)).toEqual([
      { quantity: '4.000', expiresAt: '2026-11-20' },
    ]);
    expect(await batchesOf(store.locationId)).toEqual([
      { quantity: '6.000', expiresAt: '2026-11-20' },
    ]);
  });

  it('expiring_report_shows_near_and_overdue_dates', async () => {
    const store = await storeWithProduct(5);
    const now = new Date('2026-10-20T00:00:00.000Z');
    await stock(store, '2', '2026-10-25');
    await stock(store, '3', '2026-10-15');
    await stock(store, '4', '2027-05-01');

    const rows = await getExpiring(store.companyId, 14, now);

    // Дальняя партия в отчёт не попала, просроченная идёт первой.
    expect(rows.map((row) => row.expiresAt)).toEqual(['2026-10-15', '2026-10-25']);
    expect(rows[0]!.daysLeft).toBeLessThan(0);
    expect(rows[1]!.daysLeft).toBe(5);
  });

  it('expiring_report_of_another_company_is_empty', async () => {
    const store = await storeWithProduct(6);
    const other = await storeWithProduct(7);
    await stock(store, '2', '2026-10-25');

    // Правило 4: чужие партии не видны.
    expect(await getExpiring(other.companyId, 14, new Date('2026-10-20T00:00:00.000Z'))).toEqual(
      [],
    );
  });
});

describe('себестоимость по FIFO', () => {
  it('write_off_takes_cost_of_the_oldest_batch', async () => {
    const store = await storeWithProduct(8);
    await prisma.company.update({
      where: { id: store.companyId },
      data: { costMethod: 'FIFO' },
    });
    // Две партии разной цены: ближний срок — дешёвая.
    await stock(store, '5', '2026-11-01', '80.00');
    await stock(store, '5', '2026-12-01', '120.00');

    const result = await writeOffStock(store.companyId, store.userId, {
      locationId: store.locationId,
      reason: 'DAMAGE',
      lines: [{ productId: store.productId, quantity: '5' }],
    });
    if (result.status !== 'ok') throw new Error(result.status);

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockDocumentId: result.documentId },
    });
    // FIFO: ушла партия по 80, а не средневзвешенные 100.
    expect(movement.costPrice.toFixed(2)).toBe('80.00');
  });

  it('average_method_keeps_weighted_cost', async () => {
    const store = await storeWithProduct(9);
    await stock(store, '5', '2026-11-01', '80.00');
    await stock(store, '5', '2026-12-01', '120.00');

    const result = await writeOffStock(store.companyId, store.userId, {
      locationId: store.locationId,
      reason: 'DAMAGE',
      lines: [{ productId: store.productId, quantity: '5' }],
    });
    if (result.status !== 'ok') throw new Error(result.status);

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { stockDocumentId: result.documentId },
    });
    expect(movement.costPrice.toFixed(2)).toBe('100.00');
  });
});
