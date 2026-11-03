import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { orderFixture } from '../helpers/order-fixture';
import { shellCounts } from '@/lib/shell/counts';

const prisma = createTestPrisma();

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('счётчики меню', () => {
  it('new_order_is_counted_for_supplier_only_and_chat_unread_for_recipient', async () => {
    const first = await orderFixture(prisma, {
      index: 1,
      phones: ['7761', '7762'],
      binBase: 700,
      productBase: 700,
      upTo: 'SENT',
    });
    const second = await orderFixture(prisma, {
      index: 2,
      phones: ['7761', '7762'],
      binBase: 700,
      productBase: 700,
      upTo: 'SENT',
    });

    const chat = await prisma.chat.create({
      data: { storeId: first.storeId, supplierId: first.supplierId },
    });
    await prisma.message.create({
      data: { chatId: chat.id, authorCompanyId: first.storeId, text: 'Когда доставка?' },
    });

    const supplier = await shellCounts(first.supplierId, { store: false, allowedLocationIds: [] });
    const store = await shellCounts(first.storeId, { store: true, allowedLocationIds: [] });
    const stranger = await shellCounts(second.supplierId, {
      store: false,
      allowedLocationIds: [],
    });

    // Новая заявка ждёт поставщика; своё сообщение магазину непрочитанным не считается.
    expect(supplier).toEqual({ cart: 0, orders: 1, chat: 1 });
    expect(store).toEqual({ cart: 0, orders: 0, chat: 0 });
    // Правило 4: чужая заявка и чужой чат в счётчики второго поставщика не попадают.
    expect(stranger).toEqual({ cart: 0, orders: 1, chat: 0 });
  });

  it('cart_badge_counts_suppliers_in_store_cart', async () => {
    const { storeId, locationId, offerId } = await orderFixture(prisma, {
      index: 3,
      phones: ['7761', '7762'],
      binBase: 700,
      productBase: 700,
      upTo: 'SENT',
    });
    const cart = await prisma.cart.upsert({
      where: { locationId },
      update: {},
      create: { locationId },
    });
    await prisma.cartItem.create({ data: { cartId: cart.id, offerId, quantity: '5' } });

    expect((await shellCounts(storeId, { store: true, allowedLocationIds: [] })).cart).toBe(1);
    // Сотрудник другой точки этой корзины не видит.
    expect(
      (await shellCounts(storeId, { store: true, allowedLocationIds: ['other-location'] })).cart,
    ).toBe(0);
  });
});
