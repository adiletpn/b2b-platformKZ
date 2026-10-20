import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';

/** Правило 2: количества — 3 знака. Раздел 3.4 ТЗ: округление до кратности вверх. */
export function roundToPackSize(quantity: Decimal, packSize: Decimal): Decimal {
  if (packSize.lessThanOrEqualTo(0)) return quantity.toDecimalPlaces(3);
  return quantity.div(packSize).ceil().times(packSize).toDecimalPlaces(3);
}

export async function getOrCreateCart(locationId: string) {
  return prisma.cart.upsert({
    where: { locationId },
    update: {},
    create: { locationId },
  });
}

export type CartSupplierGroup = {
  supplierId: string;
  supplierName: string;
  minOrderAmount: string;
  total: string;
  /** Сколько не хватает до минимальной суммы заказа (раздел 3.4 ТЗ). */
  missingToMinimum: string;
  meetsMinimum: boolean;
  items: {
    offerId: string;
    nameRu: string;
    nameKk: string;
    unitRu: string;
    unitKk: string;
    quantity: string;
    packSize: string;
    minBatch: string;
    priceWithVat: string;
    lineTotal: string;
  }[];
};

/** Корзина, разбитая по поставщикам: суммы считаются в Decimal, 2 знака. */
export async function getCartGroups(
  locationId: string,
  cityId: string,
): Promise<CartSupplierGroup[]> {
  const cart = await prisma.cart.findUnique({
    where: { locationId },
    include: {
      items: {
        include: {
          offer: {
            include: { product: { include: { unit: true } }, supplier: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!cart || cart.items.length === 0) return [];

  const zones = await prisma.deliveryZone.findMany({
    where: { cityId, supplierId: { in: cart.items.map((item) => item.offer.supplierId) } },
  });
  const minBySupplier = new Map(
    zones.map((zone) => [zone.supplierId, new Decimal(zone.minOrderAmount.toString())]),
  );

  const groups = new Map<string, CartSupplierGroup>();

  for (const item of cart.items) {
    const supplierId = item.offer.supplierId;
    const quantity = new Decimal(item.quantity.toString());
    const price = new Decimal(item.offer.priceWithVat.toString());
    const lineTotal = price.times(quantity).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    const group = groups.get(supplierId) ?? {
      supplierId,
      supplierName: item.offer.supplier.name,
      minOrderAmount: (minBySupplier.get(supplierId) ?? new Decimal(0)).toFixed(2),
      total: '0.00',
      missingToMinimum: '0.00',
      meetsMinimum: true,
      items: [],
    };

    group.items.push({
      offerId: item.offerId,
      nameRu: item.offer.product.nameRu,
      nameKk: item.offer.product.nameKk,
      unitRu: item.offer.product.unit.nameRu,
      unitKk: item.offer.product.unit.nameKk,
      quantity: quantity.toFixed(3),
      packSize: item.offer.packSize.toFixed(3),
      minBatch: item.offer.minBatch.toFixed(3),
      priceWithVat: price.toFixed(2),
      lineTotal: lineTotal.toFixed(2),
    });
    group.total = new Decimal(group.total).plus(lineTotal).toFixed(2);
    groups.set(supplierId, group);
  }

  return [...groups.values()].map((group) => {
    const minimum = new Decimal(group.minOrderAmount);
    const missing = minimum.minus(group.total);
    return {
      ...group,
      meetsMinimum: missing.lessThanOrEqualTo(0),
      missingToMinimum: missing.greaterThan(0) ? missing.toFixed(2) : '0.00',
    };
  });
}

/**
 * Количество приводится к кратности упаковки; 0 убирает позицию. Меньше минимальной
 * партии поставщик не отгружает (раздел 3.2 ТЗ), поэтому такое количество поднимается до неё.
 */
export async function setCartItem(locationId: string, offerId: string, quantity: Decimal) {
  const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offerId } });
  const minBatch = new Decimal(offer.minBatch.toString());
  const wanted = quantity.greaterThan(0) && quantity.lessThan(minBatch) ? minBatch : quantity;
  const rounded = roundToPackSize(wanted, new Decimal(offer.packSize.toString()));
  const cart = await getOrCreateCart(locationId);

  if (rounded.lessThanOrEqualTo(0)) {
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, offerId } });
    return { quantity: '0.000', removed: true, rounded: false };
  }

  // Раздел 3.4 ТЗ: система округляет до кратности и предупреждает.
  const wasRounded = !rounded.equals(quantity);

  await prisma.cartItem.upsert({
    where: { cartId_offerId: { cartId: cart.id, offerId } },
    update: { quantity: rounded.toFixed(3) },
    create: { cartId: cart.id, offerId, quantity: rounded.toFixed(3) },
  });

  return { quantity: rounded.toFixed(3), removed: false, rounded: wasRounded };
}
