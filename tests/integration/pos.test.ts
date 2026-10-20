import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { registerCompany } from '@/lib/registration/register-company';
import { createOfferManually } from '@/lib/catalog/manual';
import { applyBalanceChange } from '@/lib/stock/balance';
import { receiveBatch } from '@/lib/stock/batches';
import { setMarkup, repriceAll } from '@/lib/stock/pricing';
import { closeShift, getZReport, openShift } from '@/lib/pos/shift';
import { refund, sell } from '@/lib/pos/sale';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

function ean13(base: string) {
  const digits = base.padStart(12, '0').slice(0, 12).split('').map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return `${digits.join('')}${(10 - (sum % 10)) % 10}`;
}

/** Магазин с товаром на остатке и розничной ценой: касса может продавать. */
async function shopReadyToSell(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7781${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7782${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(970 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(971 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 180' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  const offer = await createOfferManually(supplier.companyId, {
    barcode: ean13(`48700050000${index}`),
    nameRu: 'Товар кассы',
    nameKk: 'Касса тауары',
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

  // Остаток 10 по себестоимости 100 и розничная цена 130.
  await prisma.$transaction(async (tx) => {
    await receiveBatch(tx, {
      locationId: location.id,
      productId: saved.productId,
      quantity: new Decimal(10),
      costPrice: new Decimal(100),
      expiresAt: null,
    });
    await applyBalanceChange(tx, {
      locationId: location.id,
      productId: saved.productId,
      quantity: new Decimal(10),
      costPrice: new Decimal(100),
    });
  });
  await setMarkup(store.companyId, null, '30');
  await repriceAll(store.companyId, storeUser.id);

  return {
    companyId: store.companyId,
    userId: storeUser.id,
    locationId: location.id,
    productId: saved.productId,
  };
}

async function quantityOf(locationId: string, productId: string) {
  const balance = await prisma.stockBalance.findUnique({
    where: { locationId_productId: { locationId, productId } },
  });
  return balance?.quantity.toFixed(3) ?? '0.000';
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.auditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('кассовая смена', () => {
  it('shift_opens_once_per_location', async () => {
    const shop = await shopReadyToSell(1);

    const opened = await openShift(shop.companyId, shop.userId, shop.locationId, '5000');
    expect(opened.status).toBe('ok');
    if (opened.status !== 'ok') return;
    expect(opened.number.startsWith('СМЕНА-')).toBe(true);

    // Вторую смену на той же точке открыть нельзя.
    expect(await openShift(shop.companyId, shop.userId, shop.locationId)).toEqual({
      status: 'already_open',
    });
  });

  it('foreign_location_is_refused', async () => {
    const shop = await shopReadyToSell(2);
    const other = await shopReadyToSell(3);

    // Правило 4: смена открывается только на своей точке.
    expect(await openShift(shop.companyId, shop.userId, other.locationId)).toEqual({
      status: 'not_found',
    });
  });
});

describe('продажа на кассе', () => {
  it('sale_reduces_stock_and_is_fiscalized', async () => {
    const shop = await shopReadyToSell(4);
    await openShift(shop.companyId, shop.userId, shop.locationId);

    const result = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'offline-1',
      paymentType: 'CARD',
      lines: [{ productId: shop.productId, quantity: '2' }],
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // Цена 130 из переоценки: 2 × 130 = 260.
    expect(result.total).toBe('260.00');
    expect(result.fiscalId).not.toBeNull();
    expect(result.number.startsWith('ЧЕК-')).toBe(true);

    expect(await quantityOf(shop.locationId, shop.productId)).toBe('8.000');
    // Правило 3: остаток уменьшен движением.
    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { locationId: shop.locationId, type: 'ISSUE' },
    });
    expect(movement.quantity.toFixed(3)).toBe('-2.000');
    expect(movement.costPrice.toFixed(2)).toBe('100.00');
  });

  it('offline_receipt_syncs_without_duplicates', async () => {
    const shop = await shopReadyToSell(5);
    await openShift(shop.companyId, shop.userId, shop.locationId);

    const first = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'offline-same',
      paymentType: 'CASH',
      lines: [{ productId: shop.productId, quantity: '1' }],
    });
    const second = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'offline-same',
      paymentType: 'CASH',
      lines: [{ productId: shop.productId, quantity: '1' }],
    });

    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('продажа');
    expect(second.replayed).toBe(true);
    expect(second.receiptId).toBe(first.receiptId);
    // Критерий этапа 2: синхронизация офлайн-чеков без дублей.
    expect(await prisma.receipt.count({ where: { companyId: shop.companyId } })).toBe(1);
    expect(await quantityOf(shop.locationId, shop.productId)).toBe('9.000');
  });

  it('sale_without_shift_or_stock_is_refused', async () => {
    const shop = await shopReadyToSell(6);

    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, {
        clientId: 'no-shift',
        paymentType: 'CASH',
        lines: [{ productId: shop.productId, quantity: '1' }],
      }),
    ).toEqual({ status: 'no_open_shift' });

    await openShift(shop.companyId, shop.userId, shop.locationId);
    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, {
        clientId: 'too-much',
        paymentType: 'CASH',
        lines: [{ productId: shop.productId, quantity: '99' }],
      }),
    ).toEqual({ status: 'not_enough_stock', productId: shop.productId });
  });
});

describe('возврат и Z-отчёт', () => {
  it('refund_returns_goods_and_money', async () => {
    const shop = await shopReadyToSell(7);
    await openShift(shop.companyId, shop.userId, shop.locationId);
    const sale = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'to-refund',
      paymentType: 'CASH',
      lines: [{ productId: shop.productId, quantity: '3' }],
    });
    if (sale.status !== 'ok') throw new Error(sale.status);

    const result = await refund(shop.companyId, shop.userId, sale.receiptId);
    expect(result.status).toBe('ok');

    expect(await quantityOf(shop.locationId, shop.productId)).toBe('10.000');
    // Повторный возврат по тому же чеку невозможен.
    expect(await refund(shop.companyId, shop.userId, sale.receiptId)).toEqual({
      status: 'already_refunded',
    });
  });

  it('z_report_matches_receipts_of_the_shift', async () => {
    const shop = await shopReadyToSell(8);
    const opened = await openShift(shop.companyId, shop.userId, shop.locationId, '1000');
    if (opened.status !== 'ok') throw new Error(opened.status);

    await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'z-1',
      paymentType: 'CASH',
      lines: [{ productId: shop.productId, quantity: '2' }],
    });
    await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'z-2',
      paymentType: 'QR',
      lines: [{ productId: shop.productId, quantity: '1' }],
    });

    const report = (await getZReport(shop.companyId, opened.shiftId))!;

    // Критерий этапа 2: Z-отчёт совпадает с суммой чеков смены.
    expect(report.receipts).toBe(2);
    expect(report.total).toBe('390.00');
    expect(report.byPayment).toEqual({ CASH: '260.00', CARD: '0.00', QR: '130.00' });
    expect(report.cost).toBe('300.00');
    expect(report.margin).toBe('90.00');
    // В кассе должно остаться: начальные 1000 плюс наличная выручка.
    expect(report.expectedCash).toBe('1260.00');

    const closed = await closeShift(shop.companyId, shop.userId, opened.shiftId, '1260');
    expect(closed.status).toBe('ok');
    expect(await getZReport(shop.companyId, opened.shiftId)).toMatchObject({ total: '390.00' });
  });

  it('refund_lowers_shift_total', async () => {
    const shop = await shopReadyToSell(9);
    const opened = await openShift(shop.companyId, shop.userId, shop.locationId);
    if (opened.status !== 'ok') throw new Error(opened.status);

    const sale = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'r-1',
      paymentType: 'CASH',
      lines: [{ productId: shop.productId, quantity: '2' }],
    });
    if (sale.status !== 'ok') throw new Error(sale.status);
    await refund(shop.companyId, shop.userId, sale.receiptId);

    const report = (await getZReport(shop.companyId, opened.shiftId))!;
    expect(report.total).toBe('0.00');
    expect(report.refunds).toBe(1);
  });

  it('report_of_another_company_is_not_returned', async () => {
    const shop = await shopReadyToSell(10);
    const other = await shopReadyToSell(11);
    const opened = await openShift(shop.companyId, shop.userId, shop.locationId);
    if (opened.status !== 'ok') throw new Error(opened.status);

    // Правило 4: чужая смена недоступна.
    expect(await getZReport(other.companyId, opened.shiftId)).toBeNull();
  });
});
