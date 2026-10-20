import Decimal from 'decimal.js';
import type { ReceiptPaymentType } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { LONG_TRANSACTION } from '@/lib/db-tx';
import { nextDocumentNumber } from '@/lib/orders/numbering';
import { applyBalanceChange, currentBalance } from '@/lib/stock/balance';
import { consumeFefo, lotsCost } from '@/lib/stock/batches';
import { fiscalize } from '@/mocks/fiscal';
import { computeReceipt, parsePercent } from './receipt-math';

export type SaleLine = {
  productId: string;
  quantity: string;
  price?: string;
  /** Скидка на позицию, % (раздел 4.2 ТЗ). */
  discountPercent?: string;
};

export type SaleInput = {
  clientId: string;
  paymentType: ReceiptPaymentType;
  lines: SaleLine[];
  /** Скидка на весь чек, %. */
  receiptDiscountPercent?: string;
  /** Смешанная оплата: сколько наличными и сколько картой. */
  cashAmount?: string;
  cardAmount?: string;
  /** Получено наличными — для сдачи. */
  cashReceived?: string;
};

export type SaleResult =
  | {
      status: 'ok';
      receiptId: string;
      number: string;
      total: string;
      discount: string;
      change: string;
      fiscalId: string | null;
      replayed: boolean;
    }
  | { status: 'no_open_shift' }
  | { status: 'empty_receipt' }
  | { status: 'invalid_quantity' }
  | { status: 'invalid_discount' }
  | { status: 'discount_too_high'; limit: string }
  | { status: 'payment_mismatch'; total: string }
  | { status: 'not_enough_cash'; total: string }
  | { status: 'no_price'; productId: string }
  | { status: 'not_enough_stock'; productId: string };

function parseMoney(value: string | undefined): Decimal | null {
  if (value === undefined || value === '') return null;
  try {
    const amount = new Decimal(value.replace(',', '.'));
    return amount.isFinite() && amount.greaterThanOrEqualTo(0) && amount.decimalPlaces() <= 2
      ? amount
      : null;
  } catch {
    return null;
  }
}

/**
 * Продажа на кассе (раздел 4.2 ТЗ): чек уменьшает остаток движением ISSUE,
 * себестоимость берётся из партий по FEFO, чек уходит на фискализацию.
 * Скидки на позицию и на чек ограничены лимитом сотрудника (раздел 3.12 ТЗ),
 * смешанная оплата должна сойтись с суммой чека, наличных — хватить на сдачу.
 * `clientId` делает повтор безопасным: офлайн-чеки синхронизируются без дублей.
 */
export async function sell(
  companyId: string,
  userId: string,
  locationId: string,
  input: SaleInput,
  options: { maxDiscount?: string | null } = {},
): Promise<SaleResult> {
  if (input.lines.length === 0) return { status: 'empty_receipt' };

  const existing = await prisma.receipt.findFirst({
    where: { companyId, clientId: input.clientId },
  });
  if (existing) {
    return {
      status: 'ok',
      receiptId: existing.id,
      number: existing.number,
      total: existing.total.toFixed(2),
      discount: existing.discountTotal.toFixed(2),
      change: existing.cashReceived
        ? new Decimal(existing.cashReceived.toString()).minus(existing.total.toString()).toFixed(2)
        : '0.00',
      fiscalId: existing.fiscalId,
      replayed: true,
    };
  }

  const shift = await prisma.posShift.findFirst({
    where: { companyId, locationId, status: 'OPEN' },
  });
  if (!shift) return { status: 'no_open_shift' };

  let lines: {
    productId: string;
    quantity: Decimal;
    price?: Decimal;
    discountPercent: Decimal;
  }[];
  try {
    lines = input.lines.map((line) => {
      // Правило 2: количества до трёх знаков.
      const quantity = new Decimal(line.quantity.replace(',', '.'));
      if (!quantity.isFinite() || quantity.lessThanOrEqualTo(0)) throw new Error('invalid');
      return {
        productId: line.productId,
        quantity: quantity.toDecimalPlaces(3, Decimal.ROUND_HALF_UP),
        price: line.price ? new Decimal(line.price.replace(',', '.')) : undefined,
        discountPercent: parsePercent(line.discountPercent) ?? new Decimal(-1),
      };
    });
  } catch {
    return { status: 'invalid_quantity' };
  }
  const receiptPercent = parsePercent(input.receiptDiscountPercent);
  if (!receiptPercent || lines.some((line) => line.discountPercent.lessThan(0))) {
    return { status: 'invalid_discount' };
  }

  const prices = await prisma.retailPrice.findMany({
    where: { companyId, productId: { in: lines.map((line) => line.productId) } },
  });
  const priceByProduct = new Map(prices.map((row) => [row.productId, row.price]));
  for (const line of lines) {
    if (!line.price && !priceByProduct.has(line.productId)) {
      return { status: 'no_price', productId: line.productId };
    }
  }

  const priced = lines.map((line) => ({
    ...line,
    price: line.price ?? new Decimal(priceByProduct.get(line.productId)!.toString()),
  }));
  const receipt = computeReceipt(priced, receiptPercent);

  // Раздел 3.12 ТЗ: максимальная скидка на кассе — у каждого сотрудника своя.
  if (options.maxDiscount !== undefined && options.maxDiscount !== null) {
    const limit = new Decimal(options.maxDiscount);
    if (receipt.lines.some((line) => line.effectivePercent.greaterThan(limit))) {
      return { status: 'discount_too_high', limit: limit.toFixed(2) };
    }
  }

  // Оплата: смешанная сходится с итогом, наличных хватает на чек.
  let cashAmount: Decimal | null = null;
  let cardAmount: Decimal | null = null;
  let cashReceived: Decimal | null = null;
  if (input.paymentType === 'MIXED') {
    cashAmount = parseMoney(input.cashAmount);
    cardAmount = parseMoney(input.cardAmount);
    if (!cashAmount || !cardAmount || !cashAmount.plus(cardAmount).equals(receipt.total)) {
      return { status: 'payment_mismatch', total: receipt.total.toFixed(2) };
    }
  }
  if (input.paymentType === 'CASH' && input.cashReceived) {
    cashReceived = parseMoney(input.cashReceived);
    if (!cashReceived || cashReceived.lessThan(receipt.total)) {
      return { status: 'not_enough_cash', total: receipt.total.toFixed(2) };
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const line of priced) {
      const balance = await currentBalance(tx, locationId, line.productId);
      if (balance.quantity.lessThan(line.quantity)) {
        return { status: 'not_enough_stock' as const, productId: line.productId };
      }
    }

    const number = await nextDocumentNumber(tx, companyId, 'receipt');
    let costTotal = new Decimal(0);

    const created = await tx.receipt.create({
      data: {
        number,
        clientId: input.clientId,
        shiftId: shift.id,
        companyId,
        locationId,
        paymentType: input.paymentType,
        total: receipt.total.toFixed(2),
        discountTotal: receipt.discount.toFixed(2),
        cashAmount: cashAmount?.toFixed(2) ?? null,
        cardAmount: cardAmount?.toFixed(2) ?? null,
        cashReceived: cashReceived?.toFixed(2) ?? null,
        userId,
      },
    });

    for (const [index, line] of priced.entries()) {
      const computed = receipt.lines[index]!;
      const balance = await currentBalance(tx, locationId, line.productId);

      // Себестоимость — из партий по FEFO: ближний срок уходит первым.
      const lots = await consumeFefo(tx, locationId, line.productId, line.quantity);
      const cost = lotsCost(lots ?? [], balance.averageCost);
      const lineCost = cost.times(line.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      await tx.receiptItem.create({
        data: {
          receiptId: created.id,
          productId: line.productId,
          quantity: line.quantity.toFixed(3),
          price: line.price.toFixed(2),
          costPrice: cost.toFixed(2),
          discount: computed.discount.toFixed(2),
          total: computed.total.toFixed(2),
        },
      });

      // Правило 3: остаток уменьшается движением, а не правкой баланса.
      await tx.stockMovement.create({
        data: {
          locationId,
          productId: line.productId,
          quantity: line.quantity.negated().toFixed(3),
          costPrice: cost.toFixed(2),
          type: 'ISSUE',
        },
      });
      await applyBalanceChange(tx, {
        locationId,
        productId: line.productId,
        quantity: line.quantity.negated(),
        costPrice: cost,
      });

      costTotal = costTotal.plus(lineCost);
    }

    const fiscal = fiscalize(number, receipt.total.toFixed(2));
    await tx.receipt.update({
      where: { id: created.id },
      data: {
        costTotal: costTotal.toFixed(2),
        fiscalId: fiscal.fiscalId,
        fiscalUrl: fiscal.fiscalUrl,
      },
    });

    return {
      status: 'ok' as const,
      receiptId: created.id,
      number,
      total: receipt.total.toFixed(2),
      discount: receipt.discount.toFixed(2),
      change: cashReceived ? cashReceived.minus(receipt.total).toFixed(2) : '0.00',
      fiscalId: fiscal.fiscalId,
      replayed: false,
    };
  }, LONG_TRANSACTION);

  return result;
}

export type RefundResult =
  | { status: 'ok'; receiptId: string; number: string }
  | { status: 'not_found' }
  | { status: 'already_refunded' }
  | { status: 'no_open_shift' };

/** Возврат по чеку: товар возвращается на остаток, чек уходит минусом в смену. */
export async function refund(
  companyId: string,
  userId: string,
  receiptId: string,
): Promise<RefundResult> {
  const receipt = await prisma.receipt.findFirst({
    where: { id: receiptId, companyId, status: 'PAID' },
    include: { items: true },
  });
  if (!receipt) return { status: 'not_found' };

  const refunded = await prisma.receipt.findFirst({ where: { refundOf: receipt.id } });
  if (refunded) return { status: 'already_refunded' };

  const shift = await prisma.posShift.findFirst({
    where: { companyId, locationId: receipt.locationId, status: 'OPEN' },
  });
  if (!shift) return { status: 'no_open_shift' };

  return prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, companyId, 'receipt');
    const created = await tx.receipt.create({
      data: {
        number,
        clientId: `refund-${receipt.id}`,
        shiftId: shift.id,
        companyId,
        locationId: receipt.locationId,
        paymentType: receipt.paymentType,
        status: 'REFUNDED',
        total: new Decimal(receipt.total.toString()).negated().toFixed(2),
        costTotal: new Decimal(receipt.costTotal.toString()).negated().toFixed(2),
        discountTotal: new Decimal(receipt.discountTotal.toString()).negated().toFixed(2),
        cashAmount: receipt.cashAmount
          ? new Decimal(receipt.cashAmount.toString()).negated().toFixed(2)
          : null,
        cardAmount: receipt.cardAmount
          ? new Decimal(receipt.cardAmount.toString()).negated().toFixed(2)
          : null,
        refundOf: receipt.id,
        userId,
      },
    });

    for (const item of receipt.items) {
      const quantity = new Decimal(item.quantity.toString());
      const cost = new Decimal(item.costPrice.toString());

      await tx.receiptItem.create({
        data: {
          receiptId: created.id,
          productId: item.productId,
          quantity: quantity.negated().toFixed(3),
          price: item.price,
          costPrice: item.costPrice,
          discount: new Decimal(item.discount.toString()).negated().toFixed(2),
          total: new Decimal(item.total.toString()).negated().toFixed(2),
        },
      });
      await tx.stockMovement.create({
        data: {
          locationId: receipt.locationId,
          productId: item.productId,
          quantity: quantity.toFixed(3),
          costPrice: cost.toFixed(2),
          type: 'RECEIPT',
        },
      });
      await applyBalanceChange(tx, {
        locationId: receipt.locationId,
        productId: item.productId,
        quantity,
        costPrice: cost,
      });
    }

    return { status: 'ok' as const, receiptId: created.id, number };
  }, LONG_TRANSACTION);
}
