import { licensedOfferFilter } from '@/lib/licenses/licenses';
import { prisma } from '@/lib/prisma';
import { effectivePrices } from '@/lib/pricing/price';
import { windowStart as ratingWindowStart } from '@/lib/ratings/metrics';

export type CompetingOffer = {
  offerId: string;
  supplierId: string;
  supplierName: string;
  priceWithVat: string;
  minBatch: string;
  leadTimeDays: number;
  inStock: boolean;
  supplierRating: string | null;
  isCurrent: boolean;
};

export type OfferDetails = {
  offerId: string;
  barcode: string;
  nameRu: string;
  nameKk: string;
  brand: string | null;
  manufacturer: string | null;
  country: string | null;
  unitRu: string;
  unitKk: string;
  packSize: string;
  minBatch: string;
  /** Срок годности партии поставщика (раздел 3.2 ТЗ). */
  expiresAt: string | null;
  isMarked: boolean;
  isExcise: boolean;
  requiresSnt: boolean;
  isLicensed: boolean;
  tnvedCode: string | null;
  photoUrls: string[];
  /** Сравнение цен этого товара у поставщиков города (раздел 3.3 ТЗ). */
  offers: CompetingOffer[];
};

/**
 * Тап по карточке: подробности товара и сравнение цен у других поставщиков,
 * которые возят в город точки магазина (разделы 3.2 и 3.3 ТЗ).
 */
export async function getOfferDetails(
  storeId: string,
  cityId: string,
  offerId: string,
): Promise<OfferDetails | null> {
  const zones = await prisma.deliveryZone.findMany({ where: { cityId } });
  const supplierIds = zones.map((zone) => zone.supplierId);
  // Правило 4 и раздел 3.9: товар виден только если поставщик возит в город точки.
  if (supplierIds.length === 0) return null;

  const licensed = await licensedOfferFilter(storeId);
  const offer = await prisma.supplierOffer.findFirst({
    where: { id: offerId, isActive: true, supplierId: { in: supplierIds }, AND: [licensed] },
    include: { product: { include: { unit: true } } },
  });
  if (!offer) return null;

  const competing = await prisma.supplierOffer.findMany({
    where: {
      productId: offer.productId,
      isActive: true,
      supplierId: { in: supplierIds },
      AND: [licensed],
    },
    include: { supplier: { select: { name: true } } },
  });

  const prices = await effectivePrices(
    competing.map((item) => ({
      id: item.id,
      priceWithVat: item.priceWithVat.toString(),
      supplierId: item.supplierId,
    })),
    storeId,
  );

  const ratings = await prisma.rating.groupBy({
    by: ['targetCompanyId'],
    where: {
      targetCompanyId: { in: competing.map((item) => item.supplierId) },
      createdAt: { gte: ratingWindowStart() },
      hiddenAt: null,
    },
    _avg: { score: true },
  });
  const ratingBySupplier = new Map(
    ratings.map((row) => [row.targetCompanyId, row._avg.score?.toFixed(2) ?? null]),
  );
  const leadTimeBySupplier = new Map(zones.map((zone) => [zone.supplierId, zone.leadTimeDays]));

  const offers = competing
    .map<CompetingOffer>((item) => ({
      offerId: item.id,
      supplierId: item.supplierId,
      supplierName: item.supplier.name,
      priceWithVat: prices.get(item.id)?.priceWithVat ?? item.priceWithVat.toFixed(2),
      minBatch: item.minBatch.toFixed(3),
      leadTimeDays: leadTimeBySupplier.get(item.supplierId) ?? 1,
      inStock: item.stock.greaterThan(0),
      supplierRating: ratingBySupplier.get(item.supplierId) ?? null,
      isCurrent: item.id === offer.id,
    }))
    .sort((left, right) => Number(left.priceWithVat) - Number(right.priceWithVat));

  return {
    offerId: offer.id,
    barcode: offer.product.barcode,
    nameRu: offer.product.nameRu,
    nameKk: offer.product.nameKk,
    brand: offer.product.brand,
    manufacturer: offer.product.manufacturer,
    country: offer.product.country,
    unitRu: offer.product.unit.nameRu,
    unitKk: offer.product.unit.nameKk,
    packSize: offer.packSize.toFixed(3),
    minBatch: offer.minBatch.toFixed(3),
    expiresAt: offer.expiresAt?.toISOString().slice(0, 10) ?? null,
    isMarked: offer.product.isMarked,
    isExcise: offer.product.isExcise,
    requiresSnt: offer.product.requiresSnt,
    isLicensed: offer.product.isLicensed,
    tnvedCode: offer.product.tnvedCode,
    photoUrls: offer.product.photoUrls,
    offers,
  };
}
