import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { registerCompany } from '@/lib/registration/register-company';
import { createOfferManually } from '@/lib/catalog/manual';
import { applyBalanceChange } from '@/lib/stock/balance';
import { receiveBatch } from '@/lib/stock/batches';
import { setMarkup, repriceAll } from '@/lib/stock/pricing';
import { cashOperation, closeShift, getSalesReport, getZReport, openShift } from '@/lib/pos/shift';
import { refund, sell, sendElectronicReceipt } from '@/lib/pos/sale';
import { checkApproval, requestApprovalCode } from '@/lib/pos/approval';
import { getRecommendations } from '@/lib/stock/replenishment';
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

describe('скидки, оплата и наличные (раздел 4.2 ТЗ)', () => {
  it('discounts_lower_total_and_respect_cashier_limit', async () => {
    const shop = await shopReadyToSell(12);
    await openShift(shop.companyId, shop.userId, shop.locationId);
    const line = { productId: shop.productId, quantity: '2', discountPercent: '10' };

    // Кассиру разрешено не больше 15%: 10% на позицию и 10% на чек дают 19%.
    expect(
      await sell(
        shop.companyId,
        shop.userId,
        shop.locationId,
        { clientId: 'd-1', paymentType: 'CARD', lines: [line], receiptDiscountPercent: '10' },
        { maxDiscount: '15.00' },
      ),
    ).toEqual({ status: 'discount_too_high', limit: '15.00' });
    expect(await prisma.receipt.count()).toBe(0);

    const sold = await sell(
      shop.companyId,
      shop.userId,
      shop.locationId,
      { clientId: 'd-2', paymentType: 'CARD', lines: [line], receiptDiscountPercent: '5' },
      { maxDiscount: '15.00' },
    );
    // 2 × 130 = 260, −10% = 234, −5% = 222.30.
    expect(sold).toMatchObject({ status: 'ok', total: '222.30', discount: '37.70' });
    const item = await prisma.receiptItem.findFirstOrThrow();
    expect(item.discount.toFixed(2)).toBe('37.70');
    expect(item.total.toFixed(2)).toBe('222.30');

    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, {
        clientId: 'd-3',
        paymentType: 'CARD',
        lines: [{ ...line, discountPercent: '150' }],
      }),
    ).toEqual({ status: 'invalid_discount' });
  });

  it('mixed_payment_must_match_total_and_cash_gives_change', async () => {
    const shop = await shopReadyToSell(12);
    await openShift(shop.companyId, shop.userId, shop.locationId);
    const lines = [{ productId: shop.productId, quantity: '1' }];

    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, {
        clientId: 'm-1',
        paymentType: 'MIXED',
        lines,
        cashAmount: '100.00',
        cardAmount: '20.00',
      }),
    ).toEqual({ status: 'payment_mismatch', total: '130.00' });
    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, {
        clientId: 'm-2',
        paymentType: 'MIXED',
        lines,
        cashAmount: '100.00',
        cardAmount: '30.00',
      }),
    ).toMatchObject({ status: 'ok', total: '130.00' });

    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, {
        clientId: 'c-1',
        paymentType: 'CASH',
        lines,
        cashReceived: '100',
      }),
    ).toEqual({ status: 'not_enough_cash', total: '130.00' });
    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, {
        clientId: 'c-2',
        paymentType: 'CASH',
        lines,
        cashReceived: '200',
      }),
    ).toMatchObject({ status: 'ok', change: '70.00' });

    // В отчёте смешанная оплата делится на наличные и карту.
    const shift = await prisma.posShift.findFirstOrThrow({ where: { companyId: shop.companyId } });
    const report = (await getZReport(shop.companyId, shift.id))!;
    expect(report.byPayment).toEqual({ CASH: '230.00', CARD: '30.00', QR: '0.00' });
    expect(report.averageCheck).toBe('130.00');
    expect(report.margin).toBe('60.00');
  });

  it('cash_in_and_out_change_drawer_and_cannot_take_more', async () => {
    const shop = await shopReadyToSell(12);
    await openShift(shop.companyId, shop.userId, shop.locationId, '1000');
    const op = (type: 'CASH_IN' | 'CASH_OUT', amount: string, reason = 'размен') =>
      cashOperation(shop.companyId, shop.userId, shop.locationId, { type, amount, reason });

    expect((await op('CASH_IN', '500')).status).toBe('ok');
    expect((await op('CASH_OUT', '300', 'инкассация')).status).toBe('ok');
    expect(await op('CASH_OUT', '5000', 'инкассация')).toEqual({
      status: 'not_enough_cash',
      available: '1200.00',
    });
    expect((await op('CASH_IN', '10', ' ')).status).toBe('reason_required');
    expect((await op('CASH_IN', '-5')).status).toBe('invalid_amount');

    const shift = await prisma.posShift.findFirstOrThrow({ where: { companyId: shop.companyId } });
    expect(await getZReport(shop.companyId, shift.id)).toMatchObject({
      cashIn: '500.00',
      cashOut: '300.00',
      expectedCash: '1200.00',
    });
    // Без открытой смены операция не проходит.
    await closeShift(shop.companyId, shop.userId, shift.id);
    expect((await op('CASH_IN', '10')).status).toBe('no_open_shift');
  });

  it('refund_of_mixed_receipt_reverses_parts_and_period_report_counts_cashiers', async () => {
    const shop = await shopReadyToSell(12);
    await openShift(shop.companyId, shop.userId, shop.locationId);
    const sold = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'r-1',
      paymentType: 'MIXED',
      lines: [{ productId: shop.productId, quantity: '2' }],
      cashAmount: '60.00',
      cardAmount: '200.00',
    });
    if (sold.status !== 'ok') throw new Error(sold.status);
    await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'r-2',
      paymentType: 'QR',
      lines: [{ productId: shop.productId, quantity: '1' }],
    });
    await refund(shop.companyId, shop.userId, sold.receiptId);

    const now = Date.now();
    const report = await getSalesReport(
      shop.companyId,
      new Date(now - 3_600_000),
      new Date(now + 3_600_000),
    );
    expect(report).toMatchObject({ receipts: 2, refunds: 1, total: '130.00' });
    expect(report.byPayment).toEqual({ CASH: '0.00', CARD: '0.00', QR: '130.00' });
    expect(report.byCashier).toHaveLength(1);
    expect(report.topProducts[0]).toMatchObject({ quantity: '1.000', total: '130.00' });
    // Правило 4: чужая компания отчёта не получит.
    const other = await getSalesReport(
      'another-company',
      new Date(now - 3_600_000),
      new Date(now + 3_600_000),
    );
    expect(other.receipts).toBe(0);
  });
});

describe('маркировка, акциз и электронный чек (раздел 4.2 ТЗ)', () => {
  /** Код DataMatrix: «01» + GTIN-14 из штрихкода + серийный номер. */
  async function codeFor(productId: string, serial: string) {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    return `01${product.barcode.padStart(14, '0')}21${serial}`;
  }

  it('marked_goods_need_one_unique_code_per_unit', async () => {
    const shop = await shopReadyToSell(13);
    await prisma.product.update({ where: { id: shop.productId }, data: { isMarked: true } });
    await openShift(shop.companyId, shop.userId, shop.locationId);
    const [first, second] = [
      await codeFor(shop.productId, 'AAA111'),
      await codeFor(shop.productId, 'BBB222'),
    ];
    const sale = (clientId: string, markingCodes?: string[]) =>
      sell(shop.companyId, shop.userId, shop.locationId, {
        clientId,
        paymentType: 'CARD',
        lines: [{ productId: shop.productId, quantity: '2', markingCodes }],
      });

    // Без кодов, с одним кодом на две единицы и с чужим GTIN продать нельзя.
    expect(await sale('m-1')).toEqual({ status: 'marking_required', productId: shop.productId });
    expect(await sale('m-2', [first])).toMatchObject({ status: 'marking_required' });
    expect(await sale('m-3', [first, '0100000000000000021XYZ'])).toMatchObject({
      status: 'marking_required',
    });
    expect(await sale('m-4', [first, first])).toMatchObject({ status: 'marking_required' });
    expect(await quantityOf(shop.locationId, shop.productId)).toBe('10.000');

    expect(await sale('m-5', [first, second])).toMatchObject({ status: 'ok' });
    const item = await prisma.receiptItem.findFirstOrThrow();
    expect(item.markingCodes).toEqual([first, second]);

    // Тот же код второй раз не пробивается.
    const third = await codeFor(shop.productId, 'CCC333');
    expect(await sale('m-6', [first, third])).toEqual({
      status: 'marking_reused',
      productId: shop.productId,
    });
  });

  it('excise_goods_need_age_confirmation_and_allowed_hours', async () => {
    const shop = await shopReadyToSell(14);
    await prisma.product.update({ where: { id: shop.productId }, data: { isExcise: true } });
    await openShift(shop.companyId, shop.userId, shop.locationId);
    const input = (clientId: string, ageConfirmed?: boolean) => ({
      clientId,
      paymentType: 'CARD' as const,
      lines: [{ productId: shop.productId, quantity: '1' }],
      ageConfirmed,
    });
    // 12:00 и 02:00 по Алматы (UTC+5).
    const noon = new Date('2026-10-20T07:00:00Z');
    const night = new Date('2026-10-20T21:00:00Z');

    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, input('x-1'), { now: noon }),
    ).toEqual({ status: 'age_not_confirmed' });
    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, input('x-2', true), { now: night }),
    ).toEqual({ status: 'restricted_hours', hours: '08:00-23:00' });
    expect(
      await sell(shop.companyId, shop.userId, shop.locationId, input('x-3', true), { now: noon }),
    ).toMatchObject({ status: 'ok' });
    const receipt = await prisma.receipt.findFirstOrThrow();
    expect(receipt.ageConfirmed).toBe(true);
  });

  it('electronic_receipt_only_for_own_company_and_valid_phone', async () => {
    const shop = await shopReadyToSell(13);
    const other = await shopReadyToSell(14);
    await openShift(shop.companyId, shop.userId, shop.locationId);
    const sold = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'e-1',
      paymentType: 'CASH',
      lines: [{ productId: shop.productId, quantity: '1' }],
    });
    if (sold.status !== 'ok') throw new Error(sold.status);

    expect(await sendElectronicReceipt(shop.companyId, sold.receiptId, '123', 'sms')).toEqual({
      status: 'invalid_phone',
    });
    // Правило 4: чужая компания не может разослать чек.
    expect(
      await sendElectronicReceipt(other.companyId, sold.receiptId, '+77010000000', 'sms'),
    ).toEqual({ status: 'not_found' });
    expect(
      await sendElectronicReceipt(shop.companyId, sold.receiptId, '+77010000000', 'whatsapp'),
    ).toEqual({ status: 'ok' });
  });
  it('refund_needs_code_of_senior_with_pos_update_right', async () => {
    const shop = await shopReadyToSell(1);
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: shop.userId } });
    const cashier = await prisma.user.create({ data: { phone: '+77830000030' } });
    await prisma.membership.create({
      data: { userId: cashier.id, companyId: shop.companyId, role: 'CASHIER' },
    });
    const other = await shopReadyToSell(2);
    const stranger = await prisma.user.findUniqueOrThrow({ where: { id: other.userId } });

    // Кассир и владелец чужой компании подтверждать не могут (правило 4).
    expect(await requestApprovalCode(shop.companyId, cashier.phone)).toEqual({
      status: 'not_senior',
    });
    expect(await requestApprovalCode(shop.companyId, stranger.phone)).toEqual({
      status: 'not_senior',
    });

    const issued = await requestApprovalCode(shop.companyId, owner.phone);
    expect(issued.status).toBe('ok');
    expect(await checkApproval(shop.companyId, owner.phone, '000000')).toEqual({
      status: 'invalid_code',
    });
    const code = (issued as { code: string }).code;
    expect(await checkApproval(shop.companyId, owner.phone, code)).toEqual({
      status: 'ok',
      approverId: owner.id,
    });
    // Код одноразовый.
    expect((await checkApproval(shop.companyId, owner.phone, code)).status).toBe('invalid_code');
  });

  it('recommendations_follow_sales_speed', async () => {
    const shop = await shopReadyToSell(3);
    await openShift(shop.companyId, shop.userId, shop.locationId);
    // Продано 7 из 10 за окно: 0,5 в день, остатка 3 хватит на 6 дней — меньше недели.
    const sale = await sell(shop.companyId, shop.userId, shop.locationId, {
      clientId: 'rec-1',
      paymentType: 'CARD',
      lines: [{ productId: shop.productId, quantity: '7' }],
    });
    expect(sale.status).toBe('ok');

    const rows = await getRecommendations(shop.companyId, shop.locationId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ dailySales: '0.500', daysLeft: '6.0', suggested: '4.000' });
    // Правило 4: чужая точка — пустой список.
    expect(await getRecommendations('чужая', shop.locationId)).toEqual([]);
  });
});
