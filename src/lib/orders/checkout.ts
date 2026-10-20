import { licensedOfferFilter } from '@/lib/licenses/licenses';
import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';
import { nextDocumentNumber } from './numbering';
import { orderLimitFor } from './approval';
import { checkCredit } from './credit';
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

export type CreatedOrder = {
  id: string;
  number: string;
  supplierName: string;
  total: string;
  /** Заявка ждёт согласования Владельца и поставщику ещё не ушла (раздел 3.12 ТЗ). */
  needsApproval: boolean;
  /** Заявка на паузе: превышен кредитный лимит поставщика (раздел 3.6 ТЗ). */
  creditHold: boolean;
};

export type CheckoutResult =
  | { status: 'created'; orders: CreatedOrder[] }
  | { status: 'empty_cart' }
  | { status: 'license_required'; products: string[] }
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

  // Раздел 2 ТЗ: лицензия могла истечь, пока товар лежал в корзине.
  const allowed = new Set(
    (
      await prisma.supplierOffer.findMany({
        where: {
          id: { in: cart.items.map((item) => item.offerId) },
          AND: [await licensedOfferFilter(input.storeId)],
        },
        select: { id: true },
      })
    ).map((offer) => offer.id),
  );
  const unlicensed = cart.items.filter((item) => !allowed.has(item.offerId));
  if (unlicensed.length > 0) {
    const products = await prisma.product.findMany({
      where: { offers: { some: { id: { in: unlicensed.map((item) => item.offerId) } } } },
      select: { nameRu: true },
    });
    return { status: 'license_required', products: products.map((product) => product.nameRu) };
  }

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

  // Раздел 3.12 ТЗ: заявка выше лимита сотрудника уходит на согласование, а не поставщику.
  const limit = await orderLimitFor(input.storeId, input.userId);
  // Раздел 3.6 ТЗ: при превышении кредитного лимита новая заявка ставится на паузу.
  const holds = new Map<string, boolean>();
  for (const [supplierId, total] of totals) {
    holds.set(supplierId, (await checkCredit(input.storeId, supplierId, total)).exceeded);
  }

  const created = await prisma.$transaction(async (tx) => {
    const orders: CreatedOrder[] = [];

    for (const [supplierId, items] of bySupplier) {
      const number = await nextDocumentNumber(tx, input.storeId, 'order');
      const total = totals.get(supplierId)!;
      const needsApproval = limit !== null && total.greaterThan(limit);
      const creditHold = holds.get(supplierId) ?? false;
      const status = needsApproval || creditHold ? 'DRAFT' : 'SENT';

      const order = await tx.order.create({
        data: {
          number,
          storeId: input.storeId,
          supplierId,
          locationId: input.locationId,
          status,
          needsApproval,
          creditHold,
          createdById: input.userId,
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
        data: { orderId: order.id, toStatus: status, userId: input.userId },
      });

      orders.push({
        id: order.id,
        number,
        supplierName: items[0]!.offer.supplier.name,
        total: total.toFixed(2),
        needsApproval,
        creditHold,
      });
    }

    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    return orders;
  }, LONG_TRANSACTION);

  for (const order of created.filter((row) => !row.needsApproval && !row.creditHold)) {
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
