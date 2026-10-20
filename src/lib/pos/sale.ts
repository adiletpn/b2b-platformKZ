import Decimal from 'decimal.js';
import type { ReceiptPaymentType } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { LONG_TRANSACTION } from '@/lib/db-tx';
import { nextDocumentNumber } from '@/lib/orders/numbering';
import { applyBalanceChange, currentBalance } from '@/lib/stock/balance';
import { consumeFefo, lotsCost } from '@/lib/stock/batches';
import { fiscalize } from '@/mocks/fiscal';

export type SaleLine = { productId: string; quantity: string; price?: string };

export type SaleResult =
  | {
      status: 'ok';
      receiptId: string;
      number: string;
      total: string;
      fiscalId: string | null;
      replayed: boolean;
    }
  | { status: 'no_open_shift' }
  | { status: 'empty_receipt' }
  | { status: 'invalid_quantity' }
  | { status: 'no_price'; productId: string }
  | { status: 'not_enough_stock'; productId: string };

/**
 * Продажа на кассе (раздел 4.2 ТЗ): чек уменьшает остаток движением ISSUE,
 * себестоимость берётся из партий по FEFO, чек уходит на фискализацию.
 * `clientId` делает повтор безопасным: офлайн-чеки синхронизируются без дублей.
 */
export async function sell(
  companyId: string,
  userId: string,
  locationId: string,
  input: { clientId: string; paymentType: ReceiptPaymentType; lines: SaleLine[] },
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
      fiscalId: existing.fiscalId,
      replayed: true,
    };
  }

  const shift = await prisma.posShift.findFirst({
    where: { companyId, locationId, status: 'OPEN' },
  });
  if (!shift) return { status: 'no_open_shift' };

  let lines: { productId: string; quantity: Decimal; price?: Decimal }[];
  try {
    lines = input.lines.map((line) => {
      // Правило 2: количества до трёх знаков.
      const quantity = new Decimal(line.quantity.replace(',', '.'));
      if (!quantity.isFinite() || quantity.lessThanOrEqualTo(0)) throw new Error('invalid');
      return {
        productId: line.productId,
        quantity: quantity.toDecimalPlaces(3, Decimal.ROUND_HALF_UP),
        price: line.price ? new Decimal(line.price.replace(',', '.')) : undefined,
      };
    });
  } catch {
    return { status: 'invalid_quantity' };
  }

  const prices = await prisma.retailPrice.findMany({
    where: { companyId, productId: { in: lines.map((line) => line.productId) } },
  });
  const priceByProduct = new Map(prices.map((row) => [row.productId, row.price]));

  const result = await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      const balance = await currentBalance(tx, locationId, line.productId);
      if (balance.quantity.lessThan(line.quantity)) {
        return { status: 'not_enough_stock' as const, productId: line.productId };
      }
      if (!line.price && !priceByProduct.has(line.productId)) {
        return { status: 'no_price' as const, productId: line.productId };
      }
    }

    const number = await nextDocumentNumber(tx, companyId, 'receipt');
    let total = new Decimal(0);
    let costTotal = new Decimal(0);

    const receipt = await tx.receipt.create({
      data: {
        number,
        clientId: input.clientId,
        shiftId: shift.id,
        companyId,
        locationId,
        paymentType: input.paymentType,
        total: '0',
        userId,
      },
    });

    for (const line of lines) {
      const balance = await currentBalance(tx, locationId, line.productId);
      const price = line.price ?? new Decimal(priceByProduct.get(line.productId)!.toString());
      const lineTotal = price.times(line.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      // Себестоимость — из партий по FEFO: ближний срок уходит первым.
      const lots = await consumeFefo(tx, locationId, line.productId, line.quantity);
      const cost = lotsCost(lots ?? [], balance.averageCost);
      const lineCost = cost.times(line.quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      await tx.receiptItem.create({
        data: {
          receiptId: receipt.id,
          productId: line.productId,
          quantity: line.quantity.toFixed(3),
          price: price.toFixed(2),
          costPrice: cost.toFixed(2),
          total: lineTotal.toFixed(2),
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

      total = total.plus(lineTotal);
      costTotal = costTotal.plus(lineCost);
    }

    const fiscal = fiscalize(number, total.toFixed(2));
    await tx.receipt.update({
      where: { id: receipt.id },
      data: {
        total: total.toFixed(2),
        costTotal: costTotal.toFixed(2),
        fiscalId: fiscal.fiscalId,
        fiscalUrl: fiscal.fiscalUrl,
      },
    });

    return {
      status: 'ok' as const,
      receiptId: receipt.id,
      number,
      total: total.toFixed(2),
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
