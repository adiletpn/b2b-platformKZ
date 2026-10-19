import Decimal from 'decimal.js';
import type { WriteOffReason } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { LONG_TRANSACTION } from '@/lib/db-tx';
import { nextDocumentNumber } from '@/lib/orders/numbering';
import { writeAudit } from '@/lib/auth/permissions';
import { applyBalanceChange, currentBalance } from './balance';
import { consumeFefo, receiveBatch } from './batches';

export type DocumentLineInput = { productId: string; quantity: string };

export type StockDocumentResult =
  | { status: 'ok'; documentId: string; number: string }
  | { status: 'not_found' }
  | { status: 'same_location' }
  | { status: 'empty_lines' }
  | { status: 'invalid_quantity' }
  | { status: 'not_enough_stock'; productId: string };

/** Количества — до трёх знаков (правило 2). Отрицательных в документах не бывает. */
function parseQuantity(value: string) {
  const parsed = new Decimal(value.replace(',', '.'));
  if (!parsed.isFinite() || parsed.isNegative()) throw new Error('invalid_quantity');
  return parsed.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

async function ownLocation(companyId: string, locationId: string) {
  // Правило 4: точка должна принадлежать компании пользователя.
  return prisma.location.findFirst({ where: { id: locationId, companyId } });
}

/**
 * Перемещение между точками компании (раздел 4.1 ТЗ): расход на складе-источнике
 * и приход на складе-получателе по той же себестоимости, одной транзакцией.
 */
export async function transferStock(
  companyId: string,
  userId: string,
  input: {
    fromLocationId: string;
    toLocationId: string;
    lines: DocumentLineInput[];
    comment?: string;
  },
): Promise<StockDocumentResult> {
  if (input.fromLocationId === input.toLocationId) return { status: 'same_location' };
  if (input.lines.length === 0) return { status: 'empty_lines' };

  const [from, to] = await Promise.all([
    ownLocation(companyId, input.fromLocationId),
    ownLocation(companyId, input.toLocationId),
  ]);
  if (!from || !to) return { status: 'not_found' };

  let lines: { productId: string; quantity: Decimal }[];
  try {
    lines = input.lines.map((line) => ({
      productId: line.productId,
      quantity: parseQuantity(line.quantity),
    }));
  } catch {
    return { status: 'invalid_quantity' };
  }
  if (lines.some((line) => line.quantity.isZero())) return { status: 'invalid_quantity' };

  const result = await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      const balance = await currentBalance(tx, from.id, line.productId);
      if (balance.quantity.lessThan(line.quantity)) {
        return { status: 'not_enough_stock' as const, productId: line.productId };
      }
    }

    const number = await nextDocumentNumber(tx, companyId, 'transfer');
    const document = await tx.stockDocument.create({
      data: {
        type: 'TRANSFER',
        number,
        companyId,
        locationId: from.id,
        targetLocationId: to.id,
        comment: input.comment ?? null,
        userId,
      },
    });

    for (const line of lines) {
      const balance = await currentBalance(tx, from.id, line.productId);
      const cost = balance.averageCost;

      await tx.stockDocumentLine.create({
        data: {
          documentId: document.id,
          productId: line.productId,
          quantity: line.quantity.toFixed(3),
          costPrice: cost.toFixed(2),
        },
      });

      // Партии уезжают по FEFO и встают на приёмной точке с теми же сроками.
      const lots = await consumeFefo(tx, from.id, line.productId, line.quantity);
      for (const lot of lots ?? []) {
        await receiveBatch(tx, {
          locationId: to.id,
          productId: line.productId,
          quantity: lot.quantity,
          costPrice: lot.costPrice,
          expiresAt: lot.expiresAt,
        });
      }

      await tx.stockMovement.create({
        data: {
          locationId: from.id,
          productId: line.productId,
          quantity: line.quantity.negated().toFixed(3),
          costPrice: cost.toFixed(2),
          type: 'TRANSFER',
          stockDocumentId: document.id,
        },
      });
      await tx.stockMovement.create({
        data: {
          locationId: to.id,
          productId: line.productId,
          quantity: line.quantity.toFixed(3),
          costPrice: cost.toFixed(2),
          type: 'TRANSFER',
          stockDocumentId: document.id,
        },
      });

      await applyBalanceChange(tx, {
        locationId: from.id,
        productId: line.productId,
        quantity: line.quantity.negated(),
        costPrice: cost,
      });
      await applyBalanceChange(tx, {
        locationId: to.id,
        productId: line.productId,
        quantity: line.quantity,
        costPrice: cost,
      });
    }

    return { status: 'ok' as const, documentId: document.id, number };
  }, LONG_TRANSACTION);

  if (result.status === 'ok') {
    await writeAudit(companyId, userId, 'stock_transferred', 'StockDocument', result.documentId);
  }
  return result;
}

/** Списание с актом: порча, истёк срок, бой (раздел 4.1 ТЗ). */
export async function writeOffStock(
  companyId: string,
  userId: string,
  input: {
    locationId: string;
    reason: WriteOffReason;
    lines: DocumentLineInput[];
    comment?: string;
  },
): Promise<StockDocumentResult> {
  if (input.lines.length === 0) return { status: 'empty_lines' };

  const location = await ownLocation(companyId, input.locationId);
  if (!location) return { status: 'not_found' };

  let lines: { productId: string; quantity: Decimal }[];
  try {
    lines = input.lines.map((line) => ({
      productId: line.productId,
      quantity: parseQuantity(line.quantity),
    }));
  } catch {
    return { status: 'invalid_quantity' };
  }
  if (lines.some((line) => line.quantity.isZero())) return { status: 'invalid_quantity' };

  const result = await prisma.$transaction(async (tx) => {
    for (const line of lines) {
      const balance = await currentBalance(tx, location.id, line.productId);
      if (balance.quantity.lessThan(line.quantity)) {
        return { status: 'not_enough_stock' as const, productId: line.productId };
      }
    }

    const number = await nextDocumentNumber(tx, companyId, 'writeoff');
    const document = await tx.stockDocument.create({
      data: {
        type: 'WRITE_OFF',
        number,
        companyId,
        locationId: location.id,
        reason: input.reason,
        comment: input.comment ?? null,
        userId,
      },
    });

    for (const line of lines) {
      const balance = await currentBalance(tx, location.id, line.productId);
      const cost = balance.averageCost;

      await tx.stockDocumentLine.create({
        data: {
          documentId: document.id,
          productId: line.productId,
          quantity: line.quantity.toFixed(3),
          costPrice: cost.toFixed(2),
        },
      });
      // Списывается партия с ближайшим сроком (FEFO).
      await consumeFefo(tx, location.id, line.productId, line.quantity);
      await tx.stockMovement.create({
        data: {
          locationId: location.id,
          productId: line.productId,
          quantity: line.quantity.negated().toFixed(3),
          costPrice: cost.toFixed(2),
          type: 'WRITE_OFF',
          stockDocumentId: document.id,
        },
      });
      await applyBalanceChange(tx, {
        locationId: location.id,
        productId: line.productId,
        quantity: line.quantity.negated(),
        costPrice: cost,
      });
    }

    return { status: 'ok' as const, documentId: document.id, number };
  }, LONG_TRANSACTION);

  if (result.status === 'ok') {
    await writeAudit(companyId, userId, 'stock_written_off', 'StockDocument', result.documentId);
  }
  return result;
}

export type StocktakeLine = { productId: string; actualQuantity: string };

/**
 * Инвентаризация с описью (раздел 4.1 ТЗ): опись хранит учётное и фактическое количество,
 * расхождения выправляются движениями, а не правкой остатка напрямую (правило 3).
 */
export async function stocktake(
  companyId: string,
  userId: string,
  input: { locationId: string; lines: StocktakeLine[]; comment?: string },
): Promise<StockDocumentResult> {
  if (input.lines.length === 0) return { status: 'empty_lines' };

  const location = await ownLocation(companyId, input.locationId);
  if (!location) return { status: 'not_found' };

  let lines: { productId: string; actual: Decimal }[];
  try {
    lines = input.lines.map((line) => ({
      productId: line.productId,
      actual: parseQuantity(line.actualQuantity),
    }));
  } catch {
    return { status: 'invalid_quantity' };
  }

  const result = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, companyId, 'stocktake');
    const document = await tx.stockDocument.create({
      data: {
        type: 'STOCKTAKE',
        number,
        companyId,
        locationId: location.id,
        comment: input.comment ?? null,
        userId,
      },
    });

    for (const line of lines) {
      const balance = await currentBalance(tx, location.id, line.productId);
      const difference = line.actual.minus(balance.quantity);

      await tx.stockDocumentLine.create({
        data: {
          documentId: document.id,
          productId: line.productId,
          quantity: line.actual.toFixed(3),
          expected: balance.quantity.toFixed(3),
          costPrice: balance.averageCost.toFixed(2),
        },
      });

      // Совпало — движения не нужны, строка описи всё равно остаётся.
      if (difference.isZero()) continue;

      // Недостача уходит по FEFO, излишек приходуется партией без срока.
      if (difference.isNegative()) {
        await consumeFefo(tx, location.id, line.productId, difference.negated());
      } else {
        await receiveBatch(tx, {
          locationId: location.id,
          productId: line.productId,
          quantity: difference,
          costPrice: balance.averageCost,
        });
      }

      await tx.stockMovement.create({
        data: {
          locationId: location.id,
          productId: line.productId,
          quantity: difference.toFixed(3),
          costPrice: balance.averageCost.toFixed(2),
          type: 'INVENTORY',
          stockDocumentId: document.id,
        },
      });
      await applyBalanceChange(tx, {
        locationId: location.id,
        productId: line.productId,
        quantity: difference,
        costPrice: balance.averageCost,
      });
    }

    return { status: 'ok' as const, documentId: document.id, number };
  }, LONG_TRANSACTION);

  if (result.status === 'ok') {
    await writeAudit(companyId, userId, 'stocktake_done', 'StockDocument', result.documentId);
  }
  return result;
}

export type LedgerEntry = {
  id: string;
  createdAt: string;
  type: string;
  quantity: string;
  costPrice: string;
  locationAddress: string;
  documentNumber: string | null;
  author: string | null;
};

/** Журнал движения по товару: кто, когда и каким документом изменил остаток (раздел 4.1 ТЗ). */
export async function getProductLedger(
  companyId: string,
  productId: string,
  locationId?: string,
): Promise<LedgerEntry[]> {
  const movements = await prisma.stockMovement.findMany({
    where: {
      productId,
      // Правило 4: только точки своей компании.
      location: { companyId, ...(locationId ? { id: locationId } : {}) },
    },
    include: {
      location: { select: { address: true } },
      document: { select: { number: true } },
      stockDocument: { select: { number: true, user: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return movements.map((movement) => ({
    id: movement.id,
    createdAt: movement.createdAt.toISOString(),
    type: movement.type,
    quantity: movement.quantity.toFixed(3),
    costPrice: movement.costPrice.toFixed(2),
    locationAddress: movement.location.address,
    documentNumber: movement.stockDocument?.number ?? movement.document?.number ?? null,
    author: movement.stockDocument?.user?.name ?? null,
  }));
}
