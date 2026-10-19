import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { parseCatalogFile, type ParsedRow, type RowError } from './parse';

export type ImportResult = {
  created: number;
  updated: number;
  errors: RowError[];
};

/** Цена с НДС считается из цены без НДС и ставки справочника. Правило 1: Decimal, 2 знака. */
export function priceWithVat(priceWithoutVat: Decimal, ratePercent: Decimal): Decimal {
  return priceWithoutVat
    .times(ratePercent.div(100).plus(1))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export async function importCatalog(supplierId: string, file: ArrayBuffer): Promise<ImportResult> {
  const [units, categories, vatRates] = await Promise.all([
    prisma.unit.findMany(),
    prisma.category.findMany(),
    prisma.vatRate.findMany(),
  ]);

  const { rows, errors } = await parseCatalogFile(file, {
    unitCodes: new Set(units.map((unit) => unit.code)),
    categoryCodes: new Set(categories.map((category) => category.code)),
    vatCodes: new Set(vatRates.map((rate) => rate.code)),
  });

  if (rows.length === 0) return { created: 0, updated: 0, errors };

  const unitByCode = new Map(units.map((unit) => [unit.code, unit.id]));
  const categoryByCode = new Map(categories.map((category) => [category.code, category.id]));
  const vatByCode = new Map(vatRates.map((rate) => [rate.code, rate]));

  const existing = await prisma.supplierOffer.findMany({
    where: { supplierId },
    include: { product: { select: { barcode: true } } },
  });
  const existingBarcodes = new Set(existing.map((offer) => offer.product.barcode));

  await prisma.$transaction(
    async (tx) => {
      for (const row of rows) {
        await upsertRow(tx, supplierId, row, unitByCode, categoryByCode, vatByCode);
      }
    },
    { timeout: 120_000 },
  );

  let created = 0;
  for (const row of rows) {
    if (existingBarcodes.has(row.barcode)) continue;
    created += 1;
  }

  return { created, updated: rows.length - created, errors };
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function upsertRow(
  tx: Tx,
  supplierId: string,
  row: ParsedRow,
  unitByCode: Map<string, string>,
  categoryByCode: Map<string, string>,
  vatByCode: Map<string, { id: string; rate: Decimal }>,
) {
  const unitId = unitByCode.get(row.unitCode)!;
  const vat = vatByCode.get(row.vatCode)!;
  const categoryId = row.categoryCode ? (categoryByCode.get(row.categoryCode) ?? null) : null;

  // Раздел 3.2 ТЗ: один штрихкод — один товар в общем справочнике платформы.
  const product = await tx.product.upsert({
    where: { barcode: row.barcode },
    update: {
      nameRu: row.nameRu,
      nameKk: row.nameKk,
      brand: row.brand,
      manufacturer: row.manufacturer,
      country: row.country,
      categoryId,
      unitId,
      tnvedCode: row.tnvedCode,
      isMarked: row.isMarked,
      isExcise: row.isExcise,
      requiresSnt: row.requiresSnt,
      isLicensed: row.isLicensed,
      ...(row.photoUrl ? { photoUrls: [row.photoUrl] } : {}),
    },
    create: {
      barcode: row.barcode,
      nameRu: row.nameRu,
      nameKk: row.nameKk,
      brand: row.brand,
      manufacturer: row.manufacturer,
      country: row.country,
      categoryId,
      unitId,
      tnvedCode: row.tnvedCode,
      isMarked: row.isMarked,
      isExcise: row.isExcise,
      requiresSnt: row.requiresSnt,
      isLicensed: row.isLicensed,
      photoUrls: row.photoUrl ? [row.photoUrl] : [],
    },
  });

  const offerData = {
    sku: row.sku,
    priceWithoutVat: row.priceWithoutVat.toFixed(2),
    priceWithVat: priceWithVat(row.priceWithoutVat, new Decimal(vat.rate.toString())).toFixed(2),
    vatRateId: vat.id,
    packSize: row.packSize.toFixed(3),
    minBatch: row.minBatch.toFixed(3),
    stock: row.stock.toFixed(3),
    expiresAt: row.expiresAt,
    isActive: true,
  };

  await tx.supplierOffer.upsert({
    where: { supplierId_productId: { supplierId, productId: product.id } },
    update: offerData,
    create: { supplierId, productId: product.id, ...offerData },
  });
}
