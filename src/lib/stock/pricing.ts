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
};

/** Ценники печатаются по позициям с розничной ценой (раздел 4.1 ТЗ). */
export async function getLabels(companyId: string, productIds?: string[]): Promise<LabelRow[]> {
  const prices = await prisma.retailPrice.findMany({
    where: { companyId, ...(productIds?.length ? { productId: { in: productIds } } : {}) },
    include: { product: { select: { nameRu: true, nameKk: true, barcode: true } } },
    orderBy: { product: { nameRu: 'asc' } },
    take: 100,
  });

  return prices.map((row) => ({
    productId: row.productId,
    nameRu: row.product.nameRu,
    nameKk: row.product.nameKk,
    barcode: row.product.barcode,
    price: row.price.toFixed(2),
  }));
}
