import { prisma } from '@/lib/prisma';

/** Раздел 3.3 ТЗ: пропущенная карточка не показывается 14 дней. */
export const SKIP_HIDE_DAYS = 14;

export type FeedFilters = {
  categoryId?: string;
  supplierId?: string;
  brand?: string;
  priceMax?: string;
  search?: string;
};

export type FeedOffer = {
  id: string;
  barcode: string;
  nameRu: string;
  nameKk: string;
  brand: string | null;
  unitRu: string;
  unitKk: string;
  supplierId: string;
  supplierName: string;
  priceWithVat: string;
  pricePerPack: string;
  minBatch: string;
  packSize: string;
  stock: string;
  leadTimeDays: number;
  inStock: boolean;
};

/**
 * Лента магазина: только поставщики, которые возят в город его точки (раздел 3.9 ТЗ).
 * forSwipe убирает товары без остатка и пропущенные за последние 14 дней.
 */
export async function getFeed(
  storeId: string,
  cityId: string,
  options: { forSwipe: boolean; filters?: FeedFilters; limit?: number },
) {
  const zones = await prisma.deliveryZone.findMany({ where: { cityId } });
  const supplierIds = zones.map((zone) => zone.supplierId);
  if (supplierIds.length === 0) return [];

  const leadTimeBySupplier = new Map(zones.map((zone) => [zone.supplierId, zone.leadTimeDays]));
  const filters = options.filters ?? {};

  const hiddenOfferIds = options.forSwipe ? await getHiddenOfferIds(storeId) : [];

  const offers = await prisma.supplierOffer.findMany({
    where: {
      supplierId: filters.supplierId
        ? { equals: filters.supplierId, in: supplierIds }
        : { in: supplierIds },
      isActive: true,
      ...(options.forSwipe ? { stock: { gt: 0 } } : {}),
      ...(hiddenOfferIds.length > 0 ? { id: { notIn: hiddenOfferIds } } : {}),
      ...(filters.priceMax ? { priceWithVat: { lte: filters.priceMax } } : {}),
      product: {
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
        ...(filters.brand ? { brand: filters.brand } : {}),
        ...(filters.search
          ? {
              OR: [
                { nameRu: { contains: filters.search, mode: 'insensitive' as const } },
                { nameKk: { contains: filters.search, mode: 'insensitive' as const } },
                { barcode: { contains: filters.search } },
              ],
            }
          : {}),
      },
    },
    include: { product: { include: { unit: true } }, supplier: { select: { name: true } } },
    orderBy: [{ product: { nameRu: 'asc' } }],
    take: options.limit ?? 50,
  });

  return offers.map<FeedOffer>((offer) => ({
    id: offer.id,
    barcode: offer.product.barcode,
    nameRu: offer.product.nameRu,
    nameKk: offer.product.nameKk,
    brand: offer.product.brand,
    unitRu: offer.product.unit.nameRu,
    unitKk: offer.product.unit.nameKk,
    supplierId: offer.supplierId,
    supplierName: offer.supplier.name,
    priceWithVat: offer.priceWithVat.toFixed(2),
    pricePerPack: offer.priceWithVat.times(offer.packSize).toFixed(2),
    minBatch: offer.minBatch.toFixed(3),
    packSize: offer.packSize.toFixed(3),
    stock: offer.stock.toFixed(3),
    leadTimeDays: leadTimeBySupplier.get(offer.supplierId) ?? 1,
    inStock: offer.stock.greaterThan(0),
  }));
}

/** Что не показываем в свайпе: уже взятое и пропущенное за последние 14 дней. */
async function getHiddenOfferIds(storeId: string) {
  const since = new Date(Date.now() - SKIP_HIDE_DAYS * 24 * 60 * 60 * 1000);
  const actions = await prisma.swipeAction.findMany({
    where: {
      storeId,
      OR: [{ action: 'LIKE' }, { action: 'SKIP', createdAt: { gte: since } }],
    },
    select: { offerId: true },
  });
  return [...new Set(actions.map((action) => action.offerId))];
}
