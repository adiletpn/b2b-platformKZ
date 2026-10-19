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
  supplierRating: string | null;
  supplierRatingCount: number;
  basePriceWithVat: string;
  discountPercent: string;
  isPromo: boolean;
  isNew: boolean;
  isCheapest: boolean;
  supplierCount: number;
  /** Свайп вверх: товар в избранном магазина (раздел 3.3 ТЗ). */
  isFavorite: boolean;
};

export type Option = { id: string; name: string };
