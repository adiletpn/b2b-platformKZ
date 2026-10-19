import Decimal from 'decimal.js';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

export type BatchReceipt = {
  locationId: string;
  productId: string;
  quantity: Decimal;
  costPrice: Decimal;
  expiresAt?: Date | null;
};

/** Приход партии: та же дата годности и себестоимость — одна партия (раздел 4.1 ТЗ). */
export async function receiveBatch(tx: Prisma.TransactionClient, input: BatchReceipt) {
  const existing = await tx.stockBatch.findFirst({
    where: {
      locationId: input.locationId,
      productId: input.productId,
      expiresAt: input.expiresAt ?? null,
      costPrice: input.costPrice.toFixed(2),
    },
  });

  if (existing) {
    await tx.stockBatch.update({
      where: { id: existing.id },
      data: {
        quantity: new Decimal(existing.quantity.toString()).plus(input.quantity).toFixed(3),
      },
    });
    return;
  }

  await tx.stockBatch.create({
    data: {
      locationId: input.locationId,
      productId: input.productId,
      quantity: input.quantity.toFixed(3),
      costPrice: input.costPrice.toFixed(2),
      expiresAt: input.expiresAt ?? null,
    },
  });
}

export type ConsumedLot = { quantity: Decimal; costPrice: Decimal; expiresAt: Date | null };

/**
 * Расход по FEFO: первой уходит партия с ближайшим сроком годности (раздел 4.1 ТЗ).
 * Партии без срока уходят последними. Вернёт null, если партий не хватает.
 */
export async function consumeFefo(
  tx: Prisma.TransactionClient,
  locationId: string,
  productId: string,
  quantity: Decimal,
): Promise<ConsumedLot[] | null> {
  const batches = await tx.stockBatch.findMany({
    where: { locationId, productId, quantity: { gt: 0 } },
    orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
  });

  const available = batches.reduce(
    (sum, batch) => sum.plus(batch.quantity.toString()),
    new Decimal(0),
  );
  // Партий может не быть у остатков, заведённых до учёта партий: тогда списываем без них.
  if (available.isZero()) return [];
  if (available.lessThan(quantity)) return null;

  const consumed: ConsumedLot[] = [];
  let left = quantity;

  for (const batch of batches) {
    if (left.lessThanOrEqualTo(0)) break;
    const batchQuantity = new Decimal(batch.quantity.toString());
    const take = Decimal.min(batchQuantity, left);

    await tx.stockBatch.update({
      where: { id: batch.id },
      data: { quantity: batchQuantity.minus(take).toFixed(3) },
    });

    consumed.push({
      quantity: take,
      costPrice: new Decimal(batch.costPrice.toString()),
      expiresAt: batch.expiresAt,
    });
    left = left.minus(take);
  }

  return consumed;
}

export type ExpiringRow = {
  productId: string;
  nameRu: string;
  nameKk: string;
  locationAddress: string;
  quantity: string;
  expiresAt: string;
  daysLeft: number;
};

/** Отчёт «скоро истекает срок» (раздел 4.1 ТЗ). Просроченные тоже попадают в список. */
export async function getExpiring(
  companyId: string,
  days = 14,
  now = new Date(),
): Promise<ExpiringRow[]> {
  const edge = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const batches = await prisma.stockBatch.findMany({
    // Правило 4: только точки своей компании.
    where: {
      location: { companyId },
      quantity: { gt: 0 },
      expiresAt: { not: null, lte: edge },
    },
    include: {
      product: { select: { nameRu: true, nameKk: true } },
      location: { select: { address: true } },
    },
    orderBy: { expiresAt: 'asc' },
    take: 50,
  });

  return batches.map((batch) => ({
    productId: batch.productId,
    nameRu: batch.product.nameRu,
    nameKk: batch.product.nameKk,
    locationAddress: batch.location.address,
    quantity: batch.quantity.toFixed(3),
    expiresAt: batch.expiresAt!.toISOString().slice(0, 10),
    daysLeft: Math.floor((batch.expiresAt!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
  }));
}
