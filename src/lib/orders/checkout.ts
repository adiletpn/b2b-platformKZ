import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';
import { nextDocumentNumber } from './numbering';
import { LONG_TRANSACTION } from '@/lib/db-tx';

export type CheckoutInput = {
  storeId: string;
  locationId: string;
  cityId: string;
  userId: string;
  deliveryDate?: string;
  comment?: string;
  paymentMethod?: 'PREPAY' | 'ON_DELIVERY' | 'DEFERRED';
};

export type CheckoutResult =
  | {
      status: 'created';
      orders: { id: string; number: string; supplierName: string; total: string }[];
    }
  | { status: 'empty_cart' }
  | { status: 'below_minimum'; suppliers: { supplierName: string; missing: string }[] };

/**
 * Раздел 3.4 ТЗ: корзина делится на заявки по поставщикам — одна заявка на каждого.
 * Всё создание идёт одной транзакцией, корзина очищается только при успехе.
 */
export async function checkout(input: CheckoutInput): Promise<CheckoutResult> {
  const cart = await prisma.cart.findUnique({
    where: { locationId: input.locationId },
    include: {
      items: { include: { offer: { include: { supplier: true, vatRate: true } } } },
    },
  });
  if (!cart || cart.items.length === 0) return { status: 'empty_cart' };

  const zones = await prisma.deliveryZone.findMany({
    where: {
      cityId: input.cityId,
      supplierId: { in: cart.items.map((item) => item.offer.supplierId) },
    },
  });
  const minBySupplier = new Map(
    zones.map((zone) => [zone.supplierId, new Decimal(zone.minOrderAmount.toString())]),
  );

  const bySupplier = new Map<string, typeof cart.items>();
  for (const item of cart.items) {
    const list = bySupplier.get(item.offer.supplierId) ?? [];
    list.push(item);
    bySupplier.set(item.offer.supplierId, list);
  }

  const totals = new Map<string, Decimal>();
  const below: { supplierName: string; missing: string }[] = [];

  for (const [supplierId, items] of bySupplier) {
    const total = items.reduce(
      (acc, item) =>
        acc.plus(
          new Decimal(item.offer.priceWithVat.toString())
            .times(new Decimal(item.quantity.toString()))
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
        ),
      new Decimal(0),
    );
    totals.set(supplierId, total);

    const minimum = minBySupplier.get(supplierId) ?? new Decimal(0);
    if (total.lessThan(minimum)) {
      below.push({
        supplierName: items[0]!.offer.supplier.name,
        missing: minimum.minus(total).toFixed(2),
      });
    }
  }

  if (below.length > 0) return { status: 'below_minimum', suppliers: below };

  const created = await prisma.$transaction(async (tx) => {
    const orders: { id: string; number: string; supplierName: string; total: string }[] = [];

    for (const [supplierId, items] of bySupplier) {
      const number = await nextDocumentNumber(tx, input.storeId, 'order');
      const total = totals.get(supplierId)!;

      const order = await tx.order.create({
        data: {
          number,
          storeId: input.storeId,
          supplierId,
          locationId: input.locationId,
          status: 'SENT',
          deliveryDate: input.deliveryDate ? new Date(input.deliveryDate) : null,
          comment: input.comment ?? null,
          paymentMethod: input.paymentMethod ?? 'ON_DELIVERY',
          totalWithVat: total.toFixed(2),
          items: {
            create: items.map((item) => ({
              offerId: item.offerId,
              quantityOrdered: item.quantity,
              priceWithoutVat: item.offer.priceWithoutVat,
              priceWithVat: item.offer.priceWithVat,
              vatRateValue: item.offer.vatRate.rate,
            })),
          },
        },
      });

      await tx.orderStatusLog.create({
        data: { orderId: order.id, toStatus: 'SENT', userId: input.userId },
      });

      orders.push({
        id: order.id,
        number,
        supplierName: items[0]!.offer.supplier.name,
        total: total.toFixed(2),
      });
    }

    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    return orders;
  }, LONG_TRANSACTION);

  for (const order of created) {
    const supplierId = [...bySupplier.keys()].find(
      (id) => bySupplier.get(id)![0]!.offer.supplier.name === order.supplierName,
    );
    if (supplierId) {
      await notify(
        supplierId,
        'order_created',
        { number: order.number, total: order.total },
        order.id,
      );
    }
  }

  return { status: 'created', orders: created };
}
