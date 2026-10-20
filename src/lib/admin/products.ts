import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { LONG_TRANSACTION } from '@/lib/db-tx';
import { writeAdminAudit } from './session';

/** Справочник товаров ведут суперадмин и контент-менеджер (раздел 3.13 ТЗ). */
export const PRODUCT_EDITOR_ROLES = ['SUPERADMIN', 'CONTENT_MANAGER'];

export type ProductRow = {
  id: string;
  barcode: string;
  nameRu: string;
  nameKk: string;
  brand: string | null;
  offers: number;
};

/** Поиск по единому справочнику: название на любом языке или начало штрихкода. */
export async function searchProducts(rawQuery: string): Promise<ProductRow[]> {
  const query = rawQuery.trim().slice(0, 100);
  if (query.length < 2) return [];
  const rows = await prisma.product.findMany({
    where: {
      OR: [
        { nameRu: { contains: query, mode: 'insensitive' } },
        { nameKk: { contains: query, mode: 'insensitive' } },
        { barcode: { startsWith: query } },
      ],
    },
    include: { _count: { select: { offers: true } } },
    orderBy: { nameRu: 'asc' },
    take: 20,
  });
  return rows.map((row) => ({
    id: row.id,
    barcode: row.barcode,
    nameRu: row.nameRu,
    nameKk: row.nameKk,
    brand: row.brand,
    offers: row._count.offers,
  }));
}

/**
 * Что мешает объединению: у одного поставщика предложения на оба товара, у одной точки
 * остатки обоих, у одной компании розничные цены на оба. Такие записи уникальны
 * по паре «владелец — товар», поэтому перенос их сломал бы, а выбирать за компанию,
 * какое предложение или цену оставить, администратор не вправе.
 */
export type MergeConflicts = {
  offers: string[];
  balances: string[];
  prices: string[];
};

export type MergeResult =
  | {
      status: 'ok';
      moved: {
        offers: number;
        balances: number;
        movements: number;
        batches: number;
        documentLines: number;
        prices: number;
        receiptItems: number;
      };
    }
  | { status: 'not_found' }
  | { status: 'same_product' }
  | { status: 'conflict'; conflicts: MergeConflicts };

export async function findMergeConflicts(
  mainId: string,
  duplicateId: string,
  client: Prisma.TransactionClient = prisma,
): Promise<MergeConflicts> {
  const [offers, balances, prices] = await Promise.all([
    client.supplierOffer.findMany({
      where: { productId: duplicateId, supplier: { offers: { some: { productId: mainId } } } },
      select: { supplier: { select: { name: true } } },
    }),
    client.stockBalance.findMany({
      where: {
        productId: duplicateId,
        location: { stockBalances: { some: { productId: mainId } } },
      },
      select: { location: { select: { address: true, company: { select: { name: true } } } } },
    }),
    client.retailPrice.findMany({
      where: { productId: duplicateId, company: { retailPrices: { some: { productId: mainId } } } },
      select: { company: { select: { name: true } } },
    }),
  ]);
  return {
    offers: offers.map((row) => row.supplier.name),
    balances: balances.map((row) => `${row.location.company.name}: ${row.location.address}`),
    prices: prices.map((row) => row.company.name),
  };
}

function hasConflicts(conflicts: MergeConflicts) {
  return conflicts.offers.length + conflicts.balances.length + conflicts.prices.length > 0;
}

/**
 * Объединение дублей единого справочника (раздел 3.13 ТЗ): все ссылки на дубль переходят
 * на главный товар одной транзакцией, дубль удаляется, действие пишется в журнал админки.
 * Главный товар сохраняет свои название, штрихкод и признаки.
 */
export async function mergeProducts(
  adminId: string,
  mainId: string,
  duplicateId: string,
): Promise<MergeResult> {
  if (mainId === duplicateId) return { status: 'same_product' };
  const [main, duplicate] = await Promise.all([
    prisma.product.findUnique({ where: { id: mainId } }),
    prisma.product.findUnique({ where: { id: duplicateId } }),
  ]);
  if (!main || !duplicate) return { status: 'not_found' };

  const result = await prisma.$transaction(async (tx) => {
    // Проверка внутри транзакции: между предпросмотром и нажатием могли появиться новые записи.
    const conflicts = await findMergeConflicts(mainId, duplicateId, tx);
    if (hasConflicts(conflicts)) return { status: 'conflict' as const, conflicts };

    const where = { productId: duplicateId };
    const data = { productId: mainId };
    const moved = {
      offers: (await tx.supplierOffer.updateMany({ where, data })).count,
      balances: (await tx.stockBalance.updateMany({ where, data })).count,
      movements: (await tx.stockMovement.updateMany({ where, data })).count,
      batches: (await tx.stockBatch.updateMany({ where, data })).count,
      documentLines: (await tx.stockDocumentLine.updateMany({ where, data })).count,
      prices: (await tx.retailPrice.updateMany({ where, data })).count,
      receiptItems: (await tx.receiptItem.updateMany({ where, data })).count,
    };
    await tx.product.delete({ where: { id: duplicateId } });
    return { status: 'ok' as const, moved };
  }, LONG_TRANSACTION);

  if (result.status === 'ok') {
    await writeAdminAudit(adminId, 'product_merged', {
      entity: 'Product',
      entityId: mainId,
      reason: `${duplicate.barcode} ${duplicate.nameRu} → ${main.barcode} ${main.nameRu}`.slice(
        0,
        500,
      ),
    });
  }
  return result;
}

export type BrandRow = { brand: string; products: number };

/** Справочник брендов строится по полю `Product.brand`: бренд и сколько у него товаров. */
export async function listBrands(): Promise<BrandRow[]> {
  const rows = await prisma.product.groupBy({
    by: ['brand'],
    where: { brand: { not: null } },
    _count: { _all: true },
    orderBy: { brand: 'asc' },
  });
  return rows
    .filter((row) => row.brand && row.brand.trim())
    .map((row) => ({ brand: row.brand!, products: row._count._all }));
}

export type RenameBrandResult =
  { status: 'ok'; updated: number } | { status: 'invalid_name' } | { status: 'not_found' };

/** Переименование бренда у всех товаров; совпадение с существующим брендом их сливает. */
export async function renameBrand(
  adminId: string,
  from: string,
  rawTo: string,
): Promise<RenameBrandResult> {
  const to = rawTo.trim().replace(/\s+/g, ' ');
  if (!to || to.length > 100) return { status: 'invalid_name' };
  const updated = await prisma.product.updateMany({ where: { brand: from }, data: { brand: to } });
  if (updated.count === 0) return { status: 'not_found' };
  await writeAdminAudit(adminId, 'brand_renamed', {
    entity: 'Brand',
    reason: `${from} → ${to}`.slice(0, 500),
  });
  return { status: 'ok', updated: updated.count };
}
