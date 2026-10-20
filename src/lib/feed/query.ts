import { licensedOfferFilter } from '@/lib/licenses/licenses';
import { prisma } from '@/lib/prisma';
import { windowStart as ratingWindowStart } from '@/lib/ratings/metrics';
import { effectivePrices, isNewProduct } from '@/lib/pricing/price';

/** Раздел 3.3 ТЗ: пропущенная карточка не показывается 14 дней. */
export const SKIP_HIDE_DAYS = 14;

export type FeedFilters = {
  categoryId?: string;
  supplierId?: string;
  brand?: string;
  priceMax?: string;
  search?: string;
  /** Фильтры раздела 3.3 ТЗ. */
  onlyPromo?: boolean;
  onlyNew?: boolean;
  onlyTomorrow?: boolean;
  onlyFavorites?: boolean;
  minRating?: string;
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
  photoUrl: string | null;
  /** Рейтинг поставщика за 12 месяцев: null — оценок ещё нет (раздел 3.3 ТЗ). */
  supplierRating: string | null;
  supplierRatingCount: number;
  /** Базовая цена до скидок: показывается зачёркнутой при акции. */
  basePriceWithVat: string;
  discountPercent: string;
  isPromo: boolean;
  isNew: boolean;
  /** Дешевле, чем у других поставщиков этого же товара в городе (раздел 3.3 ТЗ). */
  isCheapest: boolean;
  /** Сколько поставщиков возят этот товар в город. */
  supplierCount: number;
  /** Свайп вверх: товар в избранном магазина (раздел 3.3 ТЗ). */
  isFavorite: boolean;
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
  const favoriteOfferIds = await getFavoriteOfferIds(storeId);
  // Раздел 2 ТЗ: лицензируемое — только при лицензии у обеих сторон.
  const licensed = await licensedOfferFilter(storeId);

  const offers = await prisma.supplierOffer.findMany({
    where: {
      supplierId: filters.supplierId
        ? { equals: filters.supplierId, in: supplierIds }
        : { in: supplierIds },
      isActive: true,
      AND: [licensed],
      ...(options.forSwipe ? { stock: { gt: 0 } } : {}),
      ...(hiddenOfferIds.length > 0 ? { id: { notIn: hiddenOfferIds } } : {}),
      ...(filters.onlyFavorites ? { id: { in: [...favoriteOfferIds] } } : {}),
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

  // Рейтинг поставщиков берём одним запросом, а не по карточке.
  const ratings = await prisma.rating.groupBy({
    by: ['targetCompanyId'],
    where: { targetCompanyId: { in: supplierIds }, createdAt: { gte: ratingWindowStart() } },
    _avg: { score: true },
    _count: { _all: true },
  });
  const ratingBySupplier = new Map(
    ratings.map((row) => [
      row.targetCompanyId,
      { score: row._avg.score?.toFixed(2) ?? null, count: row._count._all },
    ]),
  );

  // Цены по прайсам магазина: индивидуальные прайсы, скидки от объёма и акции.
  const prices = await effectivePrices(
    offers.map((offer) => ({
      id: offer.id,
      priceWithVat: offer.priceWithVat.toString(),
      supplierId: offer.supplierId,
    })),
    storeId,
  );

  // Сравнение цен: сколько поставщиков возят товар в город и у кого дешевле.
  const competing = await prisma.supplierOffer.findMany({
    where: {
      productId: { in: offers.map((offer) => offer.productId) },
      supplierId: { in: supplierIds },
      isActive: true,
      AND: [licensed],
    },
    select: { id: true, productId: true, priceWithVat: true, supplierId: true },
  });
  const competingPrices = await effectivePrices(
    competing.map((offer) => ({
      id: offer.id,
      priceWithVat: offer.priceWithVat.toString(),
      supplierId: offer.supplierId,
    })),
    storeId,
  );

  const byProduct = new Map<string, { count: number; min: number }>();
  for (const offer of competing) {
    const price = Number(competingPrices.get(offer.id)?.priceWithVat ?? offer.priceWithVat);
    const current = byProduct.get(offer.productId) ?? { count: 0, min: Number.POSITIVE_INFINITY };
    byProduct.set(offer.productId, {
      count: current.count + 1,
      min: Math.min(current.min, price),
    });
  }

  const mapped = offers.map<FeedOffer>((offer) => ({
    id: offer.id,
    barcode: offer.product.barcode,
    nameRu: offer.product.nameRu,
    nameKk: offer.product.nameKk,
    brand: offer.product.brand,
    unitRu: offer.product.unit.nameRu,
    unitKk: offer.product.unit.nameKk,
    supplierId: offer.supplierId,
    supplierName: offer.supplier.name,
    priceWithVat: prices.get(offer.id)?.priceWithVat ?? offer.priceWithVat.toFixed(2),
    pricePerPack: offer.priceWithVat.times(offer.packSize).toFixed(2),
    minBatch: offer.minBatch.toFixed(3),
    packSize: offer.packSize.toFixed(3),
    stock: offer.stock.toFixed(3),
    leadTimeDays: leadTimeBySupplier.get(offer.supplierId) ?? 1,
    inStock: offer.stock.greaterThan(0),
    photoUrl: offer.product.photoUrls[0] ?? null,
    basePriceWithVat: prices.get(offer.id)?.basePriceWithVat ?? offer.priceWithVat.toFixed(2),
    discountPercent: prices.get(offer.id)?.discountPercent ?? '0.00',
    isPromo: prices.get(offer.id)?.isPromo ?? false,
    isNew: isNewProduct(offer.product.createdAt),
    isCheapest:
      (byProduct.get(offer.productId)?.count ?? 1) > 1 &&
      Number(prices.get(offer.id)?.priceWithVat ?? offer.priceWithVat) <=
        (byProduct.get(offer.productId)?.min ?? 0),
    supplierCount: byProduct.get(offer.productId)?.count ?? 1,
    supplierRating: ratingBySupplier.get(offer.supplierId)?.score ?? null,
    supplierRatingCount: ratingBySupplier.get(offer.supplierId)?.count ?? 0,
    isFavorite: favoriteOfferIds.has(offer.id),
  }));

  const filtered = mapped.filter((item) => {
    if (filters.onlyPromo && !item.isPromo) return false;
    if (filters.onlyNew && !item.isNew) return false;
    // «Доставка завтра» — срок доставки не больше одного дня.
    if (filters.onlyTomorrow && item.leadTimeDays > 1) return false;
    if (filters.minRating && Number(item.supplierRating ?? 0) < Number(filters.minRating)) {
      return false;
    }
    return true;
  });

  // Сортировка ленты: сначала акции и новинки, затем остальные (раздел 3.3 ТЗ).
  return filtered.sort((left, right) => {
    const weight = (item: FeedOffer) => (item.isPromo ? 0 : item.isNew ? 1 : 2);
    const byWeight = weight(left) - weight(right);
    return byWeight !== 0 ? byWeight : left.nameRu.localeCompare(right.nameRu, 'ru');
  });
}

/** Избранное магазина: свайп вверх по карточке (раздел 3.3 ТЗ). */
export async function getFavoriteOfferIds(storeId: string) {
  const actions = await prisma.swipeAction.findMany({
    where: { storeId, action: 'FAV' },
    select: { offerId: true },
  });
  return new Set(actions.map((action) => action.offerId));
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
