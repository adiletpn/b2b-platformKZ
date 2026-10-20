import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { shopReadyToSell } from '../helpers/pos-fixture';
import { getZReport, openShift } from '@/lib/pos/shift';
import { refund, sell } from '@/lib/pos/sale';
import { lookupCustomer } from '@/lib/pos/loyalty';
import { setPieceSale } from '@/lib/stock/pricing';

const prisma = createTestPrisma();
const BUYER = '+77019990001';

async function balanceOf(companyId: string) {
  const customer = await prisma.loyaltyCustomer.findUnique({
    where: { companyId_phone: { companyId, phone: BUYER } },
  });
  return customer?.balance.toFixed(2) ?? null;
}

async function quantityOf(locationId: string, productId: string) {
  const balance = await prisma.stockBalance.findUnique({
    where: { locationId_productId: { locationId, productId } },
  });
  return balance?.quantity.toFixed(3);
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('программа лояльности на кассе (этап 3)', () => {
  it('receipt_earns_bonus_and_next_receipt_redeems_it', async () => {
    const shop = await shopReadyToSell(prisma, 9);
    const opened = await openShift(shop.companyId, shop.userId, shop.locationId);
    if (opened.status !== 'ok') throw new Error(opened.status);

    // 2 × 130 = 260, начисление 5% = 13.00.
    const first = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'loyal-1',
      paymentType: 'CARD',
      customerPhone: '8 701 999 00 01',
      lines: [{ productId: shop.productId, quantity: '2' }],
    });
    if (first.status !== 'ok') throw new Error(first.status);
    expect(first.bonusEarned).toBe('13.00');
    expect(await balanceOf(shop.companyId)).toBe('13.00');

    // Больше половины чека бонусами не оплатить: 130 × 50% = 65.
    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, {
        clientId: 'loyal-limit',
        paymentType: 'CASH',
        customerPhone: BUYER,
        bonusRedeem: '66',
        lines: [{ productId: shop.productId, quantity: '1' }],
      }),
    ).toEqual({ status: 'bonus_limit', limit: '65.00' });
    // Больше баланса тоже нельзя, и остаток при этом не меняется.
    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, {
        clientId: 'loyal-more',
        paymentType: 'CASH',
        customerPhone: BUYER,
        bonusRedeem: '20',
        lines: [{ productId: shop.productId, quantity: '1' }],
      }),
    ).toEqual({ status: 'not_enough_bonus', available: '13.00' });
    expect(await quantityOf(shop.locationId, shop.productId)).toBe('8.000');

    const second = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'loyal-2',
      paymentType: 'CASH',
      customerPhone: BUYER,
      bonusRedeem: '13',
      cashReceived: '200',
      lines: [{ productId: shop.productId, quantity: '1' }],
    });
    if (second.status !== 'ok') throw new Error(second.status);
    // К оплате 130 − 13 = 117, начисление 5% от оплаченного деньгами = 5.85.
    expect(second.toPay).toBe('117.00');
    expect(second.change).toBe('83.00');
    expect(second.bonusEarned).toBe('5.85');
    expect(await balanceOf(shop.companyId)).toBe('5.85');

    // Z-отчёт: бонусы — отдельная строка оплаты, наличные в ящике без них.
    const report = await getZReport(shop.companyId, opened.shiftId);
    expect(report!.total).toBe('390.00');
    expect(report!.byPayment).toEqual({
      CASH: '117.00',
      CARD: '260.00',
      QR: '0.00',
      BONUS: '13.00',
    });
    expect(report!.bonusEarned).toBe('18.85');

    // Возврат второго чека: списанные 13 вернулись, начисленные 5.85 сняты.
    const back = await refund(shop.companyId, shop.userId, second.receiptId);
    expect(back.status).toBe('ok');
    expect(await balanceOf(shop.companyId)).toBe('13.00');
    const after = await getZReport(shop.companyId, opened.shiftId);
    expect(after!.byPayment.BONUS).toBe('0.00');
    expect(after!.byPayment.CASH).toBe('0.00');
    const movements = await prisma.loyaltyMovement.findMany({
      where: { receiptId: back.status === 'ok' ? back.receiptId : '' },
      orderBy: { type: 'asc' },
    });
    expect(movements.map((row) => [row.type, row.amount.toFixed(2)])).toEqual([
      ['EARN_REVERSAL', '-5.85'],
      ['REDEEM_REVERSAL', '13.00'],
    ]);
  });

  it('customers_are_separate_per_company', async () => {
    const shop = await shopReadyToSell(prisma, 10);
    const other = await shopReadyToSell(prisma, 11);
    await openShift(shop.companyId, shop.userId, shop.locationId);
    await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'own',
      paymentType: 'CARD',
      customerPhone: BUYER,
      lines: [{ productId: shop.productId, quantity: '1' }],
    });

    // Правило 4: у другого магазина тот же телефон — новый покупатель без бонусов.
    const mine = await lookupCustomer(shop.companyId, BUYER);
    const theirs = await lookupCustomer(other.companyId, BUYER);
    expect(mine).toMatchObject({ status: 'ok', balance: '6.50' });
    // Кассиру номер показывается маской (правило 11).
    expect(mine.status === 'ok' && mine.phone).not.toBe(BUYER);
    expect(theirs).toMatchObject({ status: 'ok', balance: '0.00' });
    expect(await lookupCustomer(shop.companyId, '123')).toEqual({ status: 'invalid_phone' });
  });
});

describe('продажа поштучно из упаковки (разделы 4.1 и 4.2 ТЗ)', () => {
  it('pieces_reduce_stock_by_pack_share', async () => {
    const shop = await shopReadyToSell(prisma, 12);
    await openShift(shop.companyId, shop.userId, shop.locationId);

    // Без настройки поштучно не продать.
    expect(
      (
        await sell(shop.companyId, shop.userId, shop.locationId, {
          clientId: 'piece-0',
          paymentType: 'CASH',
          lines: [{ productId: shop.productId, quantity: '1', byPiece: true }],
        })
      ).status,
    ).toBe('piece_sale_unavailable');

    expect(
      await setPieceSale(shop.companyId, shop.userId, shop.productId, {
        piecesPerPack: '1',
        piecePrice: '15',
      }),
    ).toEqual({ status: 'invalid_pieces' });
    expect(
      await setPieceSale(shop.companyId, shop.userId, shop.productId, {
        piecesPerPack: '12',
        piecePrice: '15',
      }),
    ).toEqual({ status: 'ok' });

    const sale = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'piece-1',
      paymentType: 'CASH',
      lines: [
        { productId: shop.productId, quantity: '1' },
        { productId: shop.productId, quantity: '5', byPiece: true },
      ],
    });
    if (sale.status !== 'ok') throw new Error(sale.status);
    // 130 за упаковку + 5 × 15 за штуки.
    expect(sale.total).toBe('205.00');
    // 5 / 12 = 0.4166… → 0.417 упаковки: 10 − 1 − 0.417.
    expect(await quantityOf(shop.locationId, shop.productId)).toBe('8.583');
    const items = await prisma.receiptItem.findMany({
      where: { receiptId: sale.receiptId, pieces: { not: null } },
    });
    expect(items.map((item) => [item.pieces, item.quantity.toFixed(3)])).toEqual([[5, '0.417']]);

    // Дробных штук не бывает.
    expect(
      (
        await sell(shop.companyId, shop.userId, shop.locationId, {
          clientId: 'piece-2',
          paymentType: 'CASH',
          lines: [{ productId: shop.productId, quantity: '1.5', byPiece: true }],
        })
      ).status,
    ).toBe('invalid_quantity');

    // Возврат возвращает ту же долю упаковки.
    await refund(shop.companyId, shop.userId, sale.receiptId);
    expect(await quantityOf(shop.locationId, shop.productId)).toBe('10.000');
  });

  it('marked_product_is_not_sold_by_piece', async () => {
    const shop = await shopReadyToSell(prisma, 13);
    await prisma.product.update({ where: { id: shop.productId }, data: { isMarked: true } });
    expect(
      await setPieceSale(shop.companyId, shop.userId, shop.productId, {
        piecesPerPack: '10',
        piecePrice: '15',
      }),
    ).toEqual({ status: 'marked_not_divisible' });
    // Чужую цену не настроить (правило 4).
    const other = await shopReadyToSell(prisma, 9);
    expect(
      await setPieceSale(other.companyId, other.userId, shop.productId, {
        piecesPerPack: '10',
        piecePrice: '15',
      }),
    ).toEqual({ status: 'not_found' });
  });
});
