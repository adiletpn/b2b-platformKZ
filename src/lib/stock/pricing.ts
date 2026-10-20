import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/auth/permissions';

export type MarkupResult = { status: 'ok' } | { status: 'invalid_percent' };

/** Правило наценки: по категории или общее для компании (раздел 4.1 ТЗ). */
export async function setMarkup(
  companyId: string,
  categoryId: string | null,
  percent: string,
): Promise<MarkupResult> {
  const value = new Decimal(percent.replace(',', '.'));
  if (!value.isFinite() || value.isNegative() || value.greaterThan(1000)) {
    return { status: 'invalid_percent' };
  }
  // Правило 1: процент хранится Decimal с двумя знаками.
  const data = { percent: value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2) };

  const existing = await prisma.markupRule.findFirst({ where: { companyId, categoryId } });
  if (existing) {
    await prisma.markupRule.update({ where: { id: existing.id }, data });
  } else {
    await prisma.markupRule.create({ data: { companyId, categoryId, ...data } });
  }

  return { status: 'ok' };
}

export type RepriceResult = { status: 'ok'; updated: number } | { status: 'no_rules' };

/**
 * Массовая переоценка (раздел 4.1 ТЗ): розничная цена считается от себестоимости
 * на остатках и правила наценки — по категории товара, иначе общего правила компании.
 */
export async function repriceAll(companyId: string, userId: string): Promise<RepriceResult> {
  const rules = await prisma.markupRule.findMany({ where: { companyId } });
  if (rules.length === 0) return { status: 'no_rules' };

  const byCategory = new Map(rules.map((rule) => [rule.categoryId, rule.percent]));
  const common = byCategory.get(null);

  const balances = await prisma.stockBalance.findMany({
    where: { location: { companyId } },
    include: { product: { select: { id: true, categoryId: true } } },
  });

  let updated = 0;
  for (const balance of balances) {
    const percent = byCategory.get(balance.product.categoryId) ?? common;
    if (!percent) continue;

    const price = new Decimal(balance.averageCost.toString())
      .times(new Decimal(percent.toString()).div(100).plus(1))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    // Нулевая себестоимость цены не даёт: товар ещё не приходовали.
    if (price.isZero()) continue;

    await prisma.retailPrice.upsert({
      where: { companyId_productId: { companyId, productId: balance.product.id } },
      update: { price: price.toFixed(2) },
      create: { companyId, productId: balance.product.id, price: price.toFixed(2) },
    });
    updated += 1;
  }

  await writeAudit(companyId, userId, 'prices_recalculated', 'Company', companyId);
  return { status: 'ok', updated };
}

export type LabelRow = {
  productId: string;
  nameRu: string;
  nameKk: string;
  barcode: string;
  price: string;
  /** Поштучная продажа из упаковки: штук в упаковке и цена штуки, иначе пусто. */
  piecesPerPack: number | null;
  piecePrice: string | null;
  isMarked: boolean;
};

/** Ценники печатаются по позициям с розничной ценой (раздел 4.1 ТЗ). */
export async function getLabels(companyId: string, productIds?: string[]): Promise<LabelRow[]> {
  const prices = await prisma.retailPrice.findMany({
    where: { companyId, ...(productIds?.length ? { productId: { in: productIds } } : {}) },
    include: {
      product: { select: { nameRu: true, nameKk: true, barcode: true, isMarked: true } },
    },
    orderBy: { product: { nameRu: 'asc' } },
    take: 100,
  });

  return prices.map((row) => ({
    productId: row.productId,
    nameRu: row.product.nameRu,
    nameKk: row.product.nameKk,
    barcode: row.product.barcode,
    price: row.price.toFixed(2),
    piecesPerPack: row.piecesPerPack,
    piecePrice: row.piecePrice?.toFixed(2) ?? null,
    isMarked: row.product.isMarked,
  }));
}

export type PieceSaleResult =
  | { status: 'ok' }
  | { status: 'not_found' }
  | { status: 'marked_not_divisible' }
  | { status: 'invalid_pieces' }
  | { status: 'invalid_price' };

/** Штука — не меньше 0,001 упаковки: остаток хранится с тремя знаками (правило 2). */
const MAX_PIECES_PER_PACK = 1_000;

/**
 * Продажа поштучно из упаковки (разделы 4.1 и 4.2 ТЗ): купили коробку — продаём штуками.
 * Магазин задаёт у своей розничной цены число штук в упаковке и цену штуки. Пустые
 * значения выключают поштучную продажу. Маркированный товар поштучно не продаётся:
 * код DataMatrix у него на каждую единицу учёта.
 */
export async function setPieceSale(
  companyId: string,
  userId: string,
  productId: string,
  input: { piecesPerPack: string | null; piecePrice: string | null },
): Promise<PieceSaleResult> {
  // Правило 4: только розничная цена своей компании.
  const retail = await prisma.retailPrice.findUnique({
    where: { companyId_productId: { companyId, productId } },
    include: { product: { select: { isMarked: true } } },
  });
  if (!retail) return { status: 'not_found' };

  const pieces = input.piecesPerPack?.trim() ?? '';
  const price = input.piecePrice?.trim().replace(',', '.') ?? '';
  if (!pieces && !price) {
    await prisma.retailPrice.update({
      where: { id: retail.id },
      data: { piecesPerPack: null, piecePrice: null },
    });
    await writeAudit(companyId, userId, 'piece_sale_disabled', 'RetailPrice', retail.id);
    return { status: 'ok' };
  }
  if (retail.product.isMarked) return { status: 'marked_not_divisible' };

  if (!/^\d+$/.test(pieces)) return { status: 'invalid_pieces' };
  const count = Number(pieces);
  if (count < 2 || count > MAX_PIECES_PER_PACK) return { status: 'invalid_pieces' };

  let piecePrice: Decimal;
  try {
    piecePrice = new Decimal(price);
  } catch {
    return { status: 'invalid_price' };
  }
  // Правило 1: деньги — Decimal, не больше двух знаков.
  if (!piecePrice.isFinite() || !piecePrice.greaterThan(0) || piecePrice.decimalPlaces() > 2) {
    return { status: 'invalid_price' };
  }

  await prisma.retailPrice.update({
    where: { id: retail.id },
    data: { piecesPerPack: count, piecePrice: piecePrice.toFixed(2) },
  });
  await writeAudit(companyId, userId, 'piece_sale_set', 'RetailPrice', retail.id);
  return { status: 'ok' };
}
