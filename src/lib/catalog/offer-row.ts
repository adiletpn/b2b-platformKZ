import type { Prisma } from '@/generated/prisma/client';

/** Что подгружать к предложению для таблицы каталога поставщика (макет D04). */
export const catalogRowInclude = {
  product: { include: { unit: true, category: true } },
  vatRate: true,
} satisfies Prisma.SupplierOfferInclude;

type OfferWithProduct = Prisma.SupplierOfferGetPayload<{ include: typeof catalogRowInclude }>;

export type CatalogRow = {
  id: string;
  barcode: string;
  nameRu: string;
  nameKk: string;
  unitRu: string;
  unitKk: string;
  categoryRu: string | null;
  categoryKk: string | null;
  photoUrl: string | null;
  priceWithoutVat: string;
  priceWithVat: string;
  vatRate: string;
  stock: string;
  minBatch: string;
  isMarked: boolean;
  requiresSnt: boolean;
};

/** Одна строка таблицы: страница каталога и API списка отдают одинаковые поля. */
export function catalogRow(offer: OfferWithProduct): CatalogRow {
  return {
    id: offer.id,
    barcode: offer.product.barcode,
    nameRu: offer.product.nameRu,
    nameKk: offer.product.nameKk,
    unitRu: offer.product.unit.nameRu,
    unitKk: offer.product.unit.nameKk,
    categoryRu: offer.product.category?.nameRu ?? null,
    categoryKk: offer.product.category?.nameKk ?? null,
    photoUrl: offer.product.photoUrls[0] ?? null,
    priceWithoutVat: offer.priceWithoutVat.toFixed(2),
    priceWithVat: offer.priceWithVat.toFixed(2),
    vatRate: offer.vatRate.rate.toFixed(2),
    stock: offer.stock.toFixed(3),
    minBatch: offer.minBatch.toFixed(3),
    isMarked: offer.product.isMarked,
    requiresSnt: offer.product.requiresSnt,
  };
}
