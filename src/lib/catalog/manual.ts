import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { isValidGtin } from './gtin';
import { priceWithVat } from './import';

export type BarcodeLookup = {
  found: boolean;
  nameRu: string;
  nameKk: string;
  brand: string | null;
  manufacturer: string | null;
  country: string | null;
  unitCode: string | null;
  categoryCode: string | null;
  tnvedCode: string | null;
  isMarked: boolean;
  isExcise: boolean;
  requiresSnt: boolean;
  isLicensed: boolean;
};

/**
 * Автозаполнение карточки по штрихкоду из общего справочника платформы (раздел 3.2 ТЗ):
 * один штрихкод — один товар, поставщик заводит только своё предложение.
 */
export async function lookupBarcode(barcode: string): Promise<BarcodeLookup | null> {
  const code = barcode.trim();
  if (!isValidGtin(code)) return null;

  const product = await prisma.product.findUnique({
    where: { barcode: code },
    include: { unit: true, category: true },
  });
  if (!product) {
    return {
      found: false,
      nameRu: '',
      nameKk: '',
      brand: null,
      manufacturer: null,
      country: null,
      unitCode: null,
      categoryCode: null,
      tnvedCode: null,
      isMarked: false,
      isExcise: false,
      requiresSnt: false,
      isLicensed: false,
    };
  }

  return {
    found: true,
    nameRu: product.nameRu,
    nameKk: product.nameKk,
    brand: product.brand,
    manufacturer: product.manufacturer,
    country: product.country,
    unitCode: product.unit.code,
    categoryCode: product.category?.code ?? null,
    tnvedCode: product.tnvedCode,
    isMarked: product.isMarked,
    isExcise: product.isExcise,
    requiresSnt: product.requiresSnt,
    isLicensed: product.isLicensed,
  };
}

export type ManualOfferInput = {
  barcode: string;
  nameRu: string;
  nameKk: string;
  unitCode: string;
  vatCode: string;
  priceWithoutVat: string;
  packSize: string;
  minBatch: string;
  stock: string;
  sku?: string;
  brand?: string;
  manufacturer?: string;
  country?: string;
  categoryCode?: string;
  tnvedCode?: string;
  expiresAt?: string;
  isMarked?: boolean;
  isExcise?: boolean;
  requiresSnt?: boolean;
  isLicensed?: boolean;
};

export type ManualOfferResult =
  | { status: 'ok'; offerId: string; created: boolean }
  | { status: 'invalid_barcode' }
  | { status: 'invalid_name' }
  | { status: 'invalid_unit' }
  | { status: 'invalid_vat' }
  | { status: 'invalid_amount' };

function quantity(value: string) {
  // Правило 2: количества до трёх знаков.
  const parsed = new Decimal(value.replace(',', '.'));
  if (!parsed.isFinite() || parsed.isNegative()) throw new Error('invalid_amount');
  return parsed.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

/** Ручной ввод карточки товара поставщиком (раздел 3.2 ТЗ). */
export async function createOfferManually(
  supplierId: string,
  input: ManualOfferInput,
): Promise<ManualOfferResult> {
  const barcode = input.barcode.trim();
  if (!isValidGtin(barcode)) return { status: 'invalid_barcode' };
  if (!input.nameRu.trim() || !input.nameKk.trim()) return { status: 'invalid_name' };

  const [unit, vat, category] = await Promise.all([
    prisma.unit.findUnique({ where: { code: input.unitCode.trim() } }),
    prisma.vatRate.findUnique({ where: { code: input.vatCode.trim() } }),
    input.categoryCode
      ? prisma.category.findUnique({ where: { code: input.categoryCode.trim() } })
      : Promise.resolve(null),
  ]);
  if (!unit) return { status: 'invalid_unit' };
  // Правило 5: ставка НДС берётся из справочника, а не из кода.
  if (!vat) return { status: 'invalid_vat' };

  let price: Decimal;
  let packSize: Decimal;
  let minBatch: Decimal;
  let stock: Decimal;
  try {
    price = new Decimal(input.priceWithoutVat.replace(',', '.'));
    if (!price.isFinite() || price.isNegative()) return { status: 'invalid_amount' };
    price = price.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    packSize = quantity(input.packSize);
    minBatch = quantity(input.minBatch);
    stock = quantity(input.stock);
  } catch {
    return { status: 'invalid_amount' };
  }
  if (packSize.isZero() || minBatch.isZero()) return { status: 'invalid_amount' };

  const existing = await prisma.supplierOffer.findFirst({
    where: { supplierId, product: { barcode } },
    select: { id: true },
  });

  const productData = {
    nameRu: input.nameRu.trim(),
    nameKk: input.nameKk.trim(),
    brand: input.brand?.trim() || null,
    manufacturer: input.manufacturer?.trim() || null,
    country: input.country?.trim() || null,
    categoryId: category?.id ?? null,
    unitId: unit.id,
    tnvedCode: input.tnvedCode?.trim() || null,
    isMarked: input.isMarked === true,
    isExcise: input.isExcise === true,
    requiresSnt: input.requiresSnt === true,
    isLicensed: input.isLicensed === true,
  };

  const offerData = {
    sku: input.sku?.trim() || null,
    priceWithoutVat: price.toFixed(2),
    priceWithVat: priceWithVat(price, new Decimal(vat.rate.toString())).toFixed(2),
    vatRateId: vat.id,
    packSize: packSize.toFixed(3),
    minBatch: minBatch.toFixed(3),
    stock: stock.toFixed(3),
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    isActive: true,
  };

  const offer = await prisma.$transaction(async (tx) => {
    const product = await tx.product.upsert({
      where: { barcode },
      update: productData,
      create: { barcode, ...productData, photoUrls: [] },
    });

    return tx.supplierOffer.upsert({
      where: { supplierId_productId: { supplierId, productId: product.id } },
      update: offerData,
      create: { supplierId, productId: product.id, ...offerData },
    });
  });

  return { status: 'ok', offerId: offer.id, created: existing === null };
}
