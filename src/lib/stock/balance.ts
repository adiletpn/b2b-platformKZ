import Decimal from 'decimal.js';
import type { Prisma } from '@/generated/prisma/client';

export type BalanceChange = {
  locationId: string;
  productId: string;
  /** Положительное — приход, отрицательное — расход. */
  quantity: Decimal;
  costPrice: Decimal;
};

/**
 * Правило 3: остаток меняется только вместе с движением и только в транзакции.
 * Себестоимость средневзвешенная (раздел 4.1 ТЗ, значение по умолчанию).
 */
export async function applyBalanceChange(tx: Prisma.TransactionClient, change: BalanceChange) {
  const balance = await tx.stockBalance.findUnique({
    where: {
      locationId_productId: { locationId: change.locationId, productId: change.productId },
    },
  });

  if (!balance) {
    await tx.stockBalance.create({
      data: {
        locationId: change.locationId,
        productId: change.productId,
        quantity: change.quantity.toFixed(3),
        averageCost: change.costPrice.toFixed(2),
      },
    });
    return;
  }

  const oldQuantity = new Decimal(balance.quantity.toString());
  const oldCost = new Decimal(balance.averageCost.toString());
  const newQuantity = oldQuantity.plus(change.quantity);

  // Расход не меняет среднюю цену, приход пересчитывает её по весам.
  const newCost = change.quantity.isNegative()
    ? oldCost
    : newQuantity.isZero()
      ? change.costPrice
      : oldQuantity
          .times(oldCost)
          .plus(change.quantity.times(change.costPrice))
          .div(newQuantity)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  await tx.stockBalance.update({
    where: { id: balance.id },
    data: { quantity: newQuantity.toFixed(3), averageCost: newCost.toFixed(2) },
  });
}

/** Текущий остаток и себестоимость позиции. */
export async function currentBalance(
  tx: Prisma.TransactionClient,
  locationId: string,
  productId: string,
) {
  const balance = await tx.stockBalance.findUnique({
    where: { locationId_productId: { locationId, productId } },
  });
  return {
    quantity: new Decimal(balance?.quantity.toString() ?? '0'),
    averageCost: new Decimal(balance?.averageCost.toString() ?? '0'),
  };
}
