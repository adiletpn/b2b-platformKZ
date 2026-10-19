import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { getOrCreateCart, setCartItem } from '@/lib/cart/cart';

/** Свайп вправо кладёт товар в корзину с минимальной партией (раздел 3.3 ТЗ). */
export async function recordSwipe(
  storeId: string,
  locationId: string,
  offerId: string,
  action: 'LIKE' | 'SKIP' | 'FAV',
) {
  const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offerId } });

  return prisma.$transaction(async (tx) => {
    await tx.swipeAction.create({ data: { storeId, offerId, action } });

    if (action !== 'LIKE') return { added: false };

    const cart = await tx.cart.upsert({
      where: { locationId },
      update: {},
      create: { locationId },
    });
    await tx.cartItem.upsert({
      where: { cartId_offerId: { cartId: cart.id, offerId } },
      update: {},
      create: { cartId: cart.id, offerId, quantity: offer.minBatch.toFixed(3) },
    });

    return { added: true };
  });
}

/** Кнопка «Отменить»: убирает последнее действие и, если это было «беру», позицию из корзины. */
export async function undoLastSwipe(storeId: string, locationId: string) {
  const last = await prisma.swipeAction.findFirst({
    where: { storeId },
    orderBy: { createdAt: 'desc' },
  });
  if (!last) return { undone: null };

  await prisma.$transaction(async (tx) => {
    await tx.swipeAction.delete({ where: { id: last.id } });
    if (last.action !== 'LIKE') return;

    const cart = await tx.cart.findUnique({ where: { locationId } });
    if (cart) await tx.cartItem.deleteMany({ where: { cartId: cart.id, offerId: last.offerId } });
  });

  return { undone: { offerId: last.offerId, action: last.action } };
}

/**
 * Раздел 3.3 ТЗ, «Повторить прошлый заказ»: позиции последней отправленной заявки
 * возвращаются в корзину с теми же количествами.
 */
export async function repeatLastOrder(storeId: string, locationId: string) {
  const lastOrder = await prisma.order.findFirst({
    where: { storeId, status: { not: 'DRAFT' } },
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
  if (!lastOrder) return { repeated: 0 };

  await getOrCreateCart(locationId);
  for (const item of lastOrder.items) {
    await setCartItem(locationId, item.offerId, new Decimal(item.quantityOrdered.toString()));
  }

  return { repeated: lastOrder.items.length };
}
