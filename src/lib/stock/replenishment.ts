import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { getOrCreateCart, roundToPackSize, setCartItem } from '@/lib/cart/cart';
import { writeAudit } from '@/lib/auth/permissions';

export type MinimumResult =
  { status: 'ok' } | { status: 'not_found' } | { status: 'invalid_quantity' };

/** Минимальный остаток по позиции точки (раздел 4.1 ТЗ). Пустое значение снимает контроль. */
export async function setMinimum(
  companyId: string,
  locationId: string,
  productId: string,
  minQuantity: string | null,
): Promise<MinimumResult> {
  // Правило 4: точка должна быть своей.
  const location = await prisma.location.findFirst({ where: { id: locationId, companyId } });
  if (!location) return { status: 'not_found' };

  const balance = await prisma.stockBalance.findUnique({
    where: { locationId_productId: { locationId, productId } },
  });
  if (!balance) return { status: 'not_found' };

  let value: string | null = null;
  if (minQuantity !== null && minQuantity.trim() !== '') {
    const parsed = new Decimal(minQuantity.replace(',', '.'));
    if (!parsed.isFinite() || parsed.isNegative()) return { status: 'invalid_quantity' };
    // Правило 2: количества до трёх знаков.
    value = parsed.toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
  }

  await prisma.stockBalance.update({ where: { id: balance.id }, data: { minQuantity: value } });
  return { status: 'ok' };
}

export type ReplenishmentRow = {
  productId: string;
  nameRu: string;
  nameKk: string;
  quantity: string;
  minQuantity: string;
  /** Сколько не хватает до минимума с учётом кратности упаковки поставщика. */
  suggested: string;
  offerId: string | null;
  supplierId: string | null;
  supplierName: string | null;
};

/**
 * Что просело ниже минимума (раздел 4.1 ТЗ). Поставщик берётся тот,
 * у кого товар покупали в последний раз.
 */
export async function getReplenishment(
  companyId: string,
  locationId: string,
): Promise<ReplenishmentRow[]> {
  const location = await prisma.location.findFirst({ where: { id: locationId, companyId } });
  if (!location) return [];

  const balances = await prisma.stockBalance.findMany({
    where: { locationId, minQuantity: { not: null } },
    include: { product: true },
    orderBy: { product: { nameRu: 'asc' } },
  });

  const below = balances.filter((balance) =>
    new Decimal(balance.quantity.toString()).lessThan(new Decimal(balance.minQuantity!.toString())),
  );
  if (below.length === 0) return [];

  // Последняя покупка по каждому товару: у кого брали, того и предлагаем.
  const lastItems = await prisma.orderItem.findMany({
    where: {
      order: { storeId: companyId, status: { not: 'DRAFT' } },
      offer: { productId: { in: below.map((balance) => balance.productId) } },
    },
    include: {
      offer: { include: { supplier: { select: { id: true, name: true } } } },
      order: { select: { createdAt: true } },
    },
    orderBy: { order: { createdAt: 'desc' } },
  });

  const lastByProduct = new Map<string, (typeof lastItems)[number]>();
  for (const item of lastItems) {
    if (!lastByProduct.has(item.offer.productId)) lastByProduct.set(item.offer.productId, item);
  }

  return below.map((balance) => {
    const last = lastByProduct.get(balance.productId);
    const missing = new Decimal(balance.minQuantity!.toString()).minus(
      new Decimal(balance.quantity.toString()),
    );
    const packSize = last ? new Decimal(last.offer.packSize.toString()) : new Decimal(1);
    const minBatch = last ? new Decimal(last.offer.minBatch.toString()) : new Decimal(0);
    const rounded = roundToPackSize(missing, packSize);
    const suggested = Decimal.max(rounded, minBatch);

    return {
      productId: balance.productId,
      nameRu: balance.product.nameRu,
      nameKk: balance.product.nameKk,
      quantity: balance.quantity.toFixed(3),
      minQuantity: new Decimal(balance.minQuantity!.toString()).toFixed(3),
      suggested: suggested.toFixed(3),
      offerId: last?.offerId ?? null,
      supplierId: last?.offer.supplier.id ?? null,
      supplierName: last?.offer.supplier.name ?? null,
    };
  });
}

export type DraftResult =
  { status: 'ok'; added: number } | { status: 'not_found' } | { status: 'nothing_to_order' };

/**
 * Автозаказ: просевшие позиции складываются в корзину — черновик заявки
 * к поставщику, у которого покупали в последний раз (раздел 4.1 ТЗ).
 */
export async function buildReplenishmentDraft(
  companyId: string,
  userId: string,
  locationId: string,
): Promise<DraftResult> {
  const location = await prisma.location.findFirst({ where: { id: locationId, companyId } });
  if (!location) return { status: 'not_found' };

  const rows = (await getReplenishment(companyId, locationId)).filter((row) => row.offerId);
  if (rows.length === 0) return { status: 'nothing_to_order' };

  await getOrCreateCart(locationId);
  for (const row of rows) {
    await setCartItem(locationId, row.offerId!, new Decimal(row.suggested));
  }

  await writeAudit(companyId, userId, 'replenishment_drafted', 'Location', locationId);
  return { status: 'ok', added: rows.length };
}
