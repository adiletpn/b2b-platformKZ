import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';

/** Наценка в процентах от себестоимости, целым числом; без себестоимости — null. */
export function markupPercent(cost: string, price: string | null): number | null {
  if (price === null) return null;
  const base = new Decimal(cost);
  if (base.lte(0)) return null;
  return new Decimal(price).minus(base).div(base).times(100).toDecimalPlaces(0).toNumber();
}

export type StockRow = {
  productId: string;
  nameRu: string;
  nameKk: string;
  barcode: string;
  photoUrl: string | null;
  unitRu: string;
  unitKk: string;
  quantity: string;
  minQuantity: string | null;
  belowMinimum: boolean;
  averageCost: string;
  retailPrice: string | null;
  markup: number | null;
  /** Ближайший срок годности по партиям на точке, ГГГГ-ММ-ДД. */
  nearestExpiry: string | null;
  /** Дней до ближайшего срока; null — сроков нет. */
  expiryDays: number | null;
};

/**
 * Таблица остатков точки как в макете D09: остаток и минимум, себестоимость, цена продажи,
 * наценка и ближайший срок годности. Только своя точка (правило 4 — locationId из контекста).
 */
export async function getStockOverview(
  companyId: string,
  locationId: string,
  now = new Date(),
): Promise<StockRow[]> {
  const [balances, prices, expiries] = await Promise.all([
    prisma.stockBalance.findMany({
      where: { locationId, location: { companyId } },
      include: { product: { include: { unit: true } } },
      orderBy: { product: { nameRu: 'asc' } },
    }),
    prisma.retailPrice.findMany({ where: { companyId }, select: { productId: true, price: true } }),
    prisma.stockBatch.groupBy({
      by: ['productId'],
      where: { locationId, quantity: { gt: 0 }, expiresAt: { not: null } },
      _min: { expiresAt: true },
    }),
  ]);
  const priceOf = new Map(prices.map((row) => [row.productId, row.price.toFixed(2)]));
  const expiryOf = new Map(
    expiries.map((row) => [row.productId, row._min.expiresAt?.toISOString().slice(0, 10) ?? null]),
  );

  return balances.map((balance) => {
    const averageCost = balance.averageCost.toFixed(2);
    const retailPrice = priceOf.get(balance.productId) ?? null;
    return {
      productId: balance.productId,
      nameRu: balance.product.nameRu,
      nameKk: balance.product.nameKk,
      barcode: balance.product.barcode,
      photoUrl: balance.product.photoUrls[0] ?? null,
      unitRu: balance.product.unit.nameRu,
      unitKk: balance.product.unit.nameKk,
      quantity: balance.quantity.toFixed(3),
      minQuantity: balance.minQuantity?.toFixed(3) ?? null,
      belowMinimum: balance.minQuantity !== null && balance.quantity.lt(balance.minQuantity),
      averageCost,
      retailPrice,
      markup: markupPercent(averageCost, retailPrice),
      nearestExpiry: expiryOf.get(balance.productId) ?? null,
      expiryDays: expiryOf.get(balance.productId)
        ? Math.floor(
            (new Date(expiryOf.get(balance.productId)!).getTime() - now.getTime()) / 86_400_000,
          )
        : null,
    };
  });
}
