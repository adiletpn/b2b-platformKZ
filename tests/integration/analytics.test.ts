import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { shopReadyToSell } from '../helpers/pos-fixture';
import { orderFixture } from '../helpers/order-fixture';
import { openShift } from '@/lib/pos/shift';
import { sell } from '@/lib/pos/sale';
import { parsePeriod, storeAnalytics, supplierAnalytics } from '@/lib/analytics/analytics';
import { analyticsXlsx } from '@/lib/exports/analytics-xlsx';

const prisma = createTestPrisma();

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('аналитика магазина (этап 3)', () => {
  it('sales_profit_abc_and_isolation', async () => {
    const shop = await shopReadyToSell(prisma, 1);
    const other = await shopReadyToSell(prisma, 3);
    await openShift(shop.companyId, shop.userId, shop.locationId);
    const sale = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'a-1',
      paymentType: 'CASH',
      lines: [{ productId: shop.productId, quantity: '3' }],
    });
    expect(sale.status).toBe('ok');

    const period = parsePeriod(null, null);
    const report = await storeAnalytics(shop.companyId, period);
    // 3 × 130 = 390, себестоимость 3 × 100 — прибыль 90.
    expect(report.revenue).toBe('390.00');
    expect(report.profit).toBe('90.00');
    expect(report.receipts).toBe(1);
    expect(report.byDay).toHaveLength(1);
    expect(report.abc).toEqual([expect.objectContaining({ group: 'A', share: '100.0' })]);
    expect(report.turnover).toEqual([
      expect.objectContaining({ stock: '7.000', sold: '3.000', stale: false }),
    ]);

    // Правило 4: у второго магазина продаж нет, его товар «лежит».
    const theirs = await storeAnalytics(other.companyId, period);
    expect(theirs.revenue).toBe('0.00');
    expect(theirs.turnover).toEqual([expect.objectContaining({ stale: true, daysOfStock: null })]);

    const file = await analyticsXlsx(report, null, {}, 'ru');
    expect(file.subarray(0, 2).toString()).toBe('PK');
  });
});

describe('аналитика поставщика (этап 3)', () => {
  it('turnover_by_store_and_fulfillment', async () => {
    const shipped = await orderFixture(prisma, {
      index: 1,
      phones: ['7791', '7792'],
      binBase: 500,
      productBase: 310000,
      upTo: 'SHIPPED',
    });
    const period = parsePeriod(null, null);
    const report = await supplierAnalytics(shipped.supplierId, period);
    // 5 × 116 (100 без НДС + 16%).
    expect(report.turnover).toBe('580.00');
    expect(report.topStores).toEqual([expect.objectContaining({ orders: 1, amount: '580.00' })]);
    expect(report.byProduct).toEqual([expect.objectContaining({ quantity: '5.000' })]);
    // Отгружена, но не доставлена — пока не считается ни выполненной, ни сорванной.
    expect(report.fulfillmentShare).toBeNull();

    await prisma.order.update({ where: { id: shipped.orderId }, data: { status: 'CLOSED' } });
    expect((await supplierAnalytics(shipped.supplierId, period)).fulfillmentShare).toBe('100.0');

    // Магазин не видит чужой оборот как поставщик.
    expect((await supplierAnalytics(shipped.storeId, period)).turnover).toBe('0.00');
  });
});
