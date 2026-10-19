import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { recordSwipe, repeatLastOrder } from '@/lib/feed/swipe';
import { getCartGroups } from '@/lib/cart/cart';
import { checkout } from '@/lib/orders/checkout';
import { changeStatus, confirmOrder, respondToChanges } from '@/lib/orders/workflow';
import { withIdempotency } from '@/lib/orders/idempotency';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function makeSupplier(index: number, products = 2) {
  const user = await prisma.user.create({
    data: { phone: `+7705${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const result = await registerCompany({
    userId: user.id,
    bin: testPoolBin(10 + index),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);

  const rows = Array.from({ length: products }, (_, item) =>
    validRow(20000 + index * 100 + item, { priceWithoutVat: '100.00', packSize: 1, minBatch: 1 }),
  );
  await importCatalog(result.companyId, toArrayBuffer(await buildCatalogXlsx(rows)));
  return { companyId: result.companyId, userId: user.id };
}

async function makeStore(index: number) {
  const user = await prisma.user.create({
    data: { phone: `+7706${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const result = await registerCompany({
    userId: user.id,
    bin: testPoolBin(30 + index),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 2' },
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);

  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: result.companyId },
  });
  return {
    companyId: result.companyId,
    userId: user.id,
    locationId: location.id,
    cityId: taraz.id,
  };
}

async function fillCart(store: Awaited<ReturnType<typeof makeStore>>, supplierIds: string[]) {
  for (const supplierId of supplierIds) {
    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId } });
    await recordSwipe(store.companyId, store.locationId, offer.id, 'LIKE');
  }
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.notification.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.numberSequence.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('создание заявок из корзины', () => {
  it('cart_with_three_suppliers_creates_three_orders', async () => {
    const suppliers = [await makeSupplier(1), await makeSupplier(2), await makeSupplier(3)];
    const store = await makeStore(1);
    await fillCart(
      store,
      suppliers.map((supplier) => supplier.companyId),
    );

    const result = await checkout({
      storeId: store.companyId,
      locationId: store.locationId,
      cityId: store.cityId,
      userId: store.userId,
    });

    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(result.orders).toHaveLength(3);

    const orders = await prisma.order.findMany({ where: { storeId: store.companyId } });
    expect(orders).toHaveLength(3);
    expect(new Set(orders.map((order) => order.supplierId)).size).toBe(3);
    for (const order of orders) expect(order.status).toBe('SENT');

    // Корзина очищается только после успешного создания.
    expect(await getCartGroups(store.locationId, store.cityId)).toEqual([]);
  });

  it('order_numbers_are_sequential_per_company', async () => {
    const suppliers = [await makeSupplier(4), await makeSupplier(5)];
    const store = await makeStore(2);
    await fillCart(
      store,
      suppliers.map((supplier) => supplier.companyId),
    );

    const result = await checkout({
      storeId: store.companyId,
      locationId: store.locationId,
      cityId: store.cityId,
      userId: store.userId,
    });
    if (result.status !== 'created') throw new Error(result.status);

    const year = new Date().getFullYear();
    expect(result.orders.map((order) => order.number).sort()).toEqual([
      `ЗАК-${year}-000001`,
      `ЗАК-${year}-000002`,
    ]);
  });

  it('checkout_is_protected_from_double_click_by_idempotency_key', async () => {
    const supplier = await makeSupplier(6);
    const store = await makeStore(3);
    await fillCart(store, [supplier.companyId]);

    const run = () =>
      withIdempotency('key-double-click', store.companyId, 'checkout', () =>
        checkout({
          storeId: store.companyId,
          locationId: store.locationId,
          cityId: store.cityId,
          userId: store.userId,
        }),
      );

    const first = await run();
    const second = await run();

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(await prisma.order.count({ where: { storeId: store.companyId } })).toBe(1);
  });

  it('checkout_blocks_when_minimum_order_amount_is_not_reached', async () => {
    const supplier = await makeSupplier(7);
    const store = await makeStore(4);
    await prisma.deliveryZone.updateMany({
      where: { supplierId: supplier.companyId },
      data: { minOrderAmount: '99999999.00' },
    });
    await fillCart(store, [supplier.companyId]);

    const result = await checkout({
      storeId: store.companyId,
      locationId: store.locationId,
      cityId: store.cityId,
      userId: store.userId,
    });

    expect(result.status).toBe('below_minimum');
    expect(await prisma.order.count()).toBe(0);
    // Корзина осталась нетронутой.
    expect(await getCartGroups(store.locationId, store.cityId)).toHaveLength(1);
  });

  it('checkout_with_empty_cart_creates_nothing', async () => {
    const store = await makeStore(5);
    const result = await checkout({
      storeId: store.companyId,
      locationId: store.locationId,
      cityId: store.cityId,
      userId: store.userId,
    });
    expect(result.status).toBe('empty_cart');
  });

  it('supplier_is_notified_about_new_order', async () => {
    const supplier = await makeSupplier(8);
    const store = await makeStore(6);
    await fillCart(store, [supplier.companyId]);

    await checkout({
      storeId: store.companyId,
      locationId: store.locationId,
      cityId: store.cityId,
      userId: store.userId,
    });

    const notifications = await prisma.notification.findMany({
      where: { companyId: supplier.companyId },
    });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.event).toBe('order_created');
    expect(notifications[0]!.channels).toEqual(['whatsapp', 'telegram', 'email']);
  });
});

describe('подтверждение заявки поставщиком', () => {
  async function sentOrder(index: number) {
    const supplier = await makeSupplier(index);
    const store = await makeStore(index);
    await fillCart(store, [supplier.companyId]);
    const result = await checkout({
      storeId: store.companyId,
      locationId: store.locationId,
      cityId: store.cityId,
      userId: store.userId,
    });
    if (result.status !== 'created') throw new Error(result.status);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: result.orders[0]!.id },
      include: { items: true },
    });
    return { supplier, store, order };
  }

  it('full_confirmation_moves_order_to_accepted', async () => {
    const { supplier, order } = await sentOrder(11);

    const result = await confirmOrder(
      order.id,
      supplier.companyId,
      supplier.userId,
      order.items.map((item) => ({
        orderItemId: item.id,
        quantityConfirmed: item.quantityOrdered.toFixed(3),
      })),
    );

    expect(result).toMatchObject({ status: 'ok', orderStatus: 'ACCEPTED' });
  });

  it('partial_confirmation_requires_store_agreement', async () => {
    const { supplier, store, order } = await sentOrder(12);
    const item = order.items[0]!;
    const half = new Decimal(item.quantityOrdered.toString()).div(2).toDecimalPlaces(3);

    const confirmed = await confirmOrder(order.id, supplier.companyId, supplier.userId, [
      { orderItemId: item.id, quantityConfirmed: half.toFixed(3) },
    ]);

    expect(confirmed).toMatchObject({ status: 'ok', orderStatus: 'CHANGED_BY_SUPPLIER' });
    // Сумма пересчитана по подтверждённому количеству.
    const expected = new Decimal(item.priceWithVat.toString()).times(half).toFixed(2);
    expect((confirmed as { total: string }).total).toBe(expected);

    const agreed = await respondToChanges(order.id, store.companyId, store.userId, true);
    expect(agreed).toMatchObject({ status: 'ok', orderStatus: 'ACCEPTED' });
  });

  it('store_can_refuse_changed_order', async () => {
    const { supplier, store, order } = await sentOrder(13);
    await confirmOrder(order.id, supplier.companyId, supplier.userId, [
      { orderItemId: order.items[0]!.id, quantityConfirmed: '0.000' },
    ]);

    const refused = await respondToChanges(order.id, store.companyId, store.userId, false);
    expect(refused).toMatchObject({ status: 'ok', orderStatus: 'CANCELLED' });
  });

  it('supplier_rejects_order_with_reason', async () => {
    const { supplier, order } = await sentOrder(14);

    const result = await changeStatus(
      order.id,
      supplier.companyId,
      supplier.userId,
      'REJECTED',
      'нет на складе',
    );

    expect(result).toMatchObject({ status: 'ok', orderStatus: 'REJECTED' });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.rejectionReason).toBe('нет на складе');
  });

  it('confirmation_above_ordered_quantity_is_rejected', async () => {
    const { supplier, order } = await sentOrder(15);
    const item = order.items[0]!;

    const result = await confirmOrder(order.id, supplier.companyId, supplier.userId, [
      {
        orderItemId: item.id,
        quantityConfirmed: new Decimal(item.quantityOrdered.toString()).plus(1).toFixed(3),
      },
    ]);

    expect(result.status).toBe('invalid_quantity');
  });

  it('order_status_follows_the_chain_to_accepted_by_store', async () => {
    const { supplier, store, order } = await sentOrder(16);
    await confirmOrder(
      order.id,
      supplier.companyId,
      supplier.userId,
      order.items.map((item) => ({
        orderItemId: item.id,
        quantityConfirmed: item.quantityOrdered.toFixed(3),
      })),
    );

    for (const status of ['PICKING', 'SHIPPED', 'DELIVERED'] as const) {
      expect(
        await changeStatus(order.id, supplier.companyId, supplier.userId, status),
      ).toMatchObject({ status: 'ok' });
    }
    expect(
      await changeStatus(order.id, store.companyId, store.userId, 'ACCEPTED_BY_STORE'),
    ).toMatchObject({ status: 'ok' });

    const logs = await prisma.orderStatusLog.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((log) => log.toStatus)).toEqual([
      'SENT',
      'ACCEPTED',
      'PICKING',
      'SHIPPED',
      'DELIVERED',
      'ACCEPTED_BY_STORE',
    ]);
  });

  it('forbidden_status_jump_is_rejected', async () => {
    const { supplier, order } = await sentOrder(17);
    const result = await changeStatus(order.id, supplier.companyId, supplier.userId, 'SHIPPED');
    expect(result).toMatchObject({ status: 'forbidden_transition', from: 'SENT', to: 'SHIPPED' });
  });

  it('store_cannot_cancel_after_picking_started', async () => {
    const { supplier, store, order } = await sentOrder(18);
    await confirmOrder(
      order.id,
      supplier.companyId,
      supplier.userId,
      order.items.map((item) => ({
        orderItemId: item.id,
        quantityConfirmed: item.quantityOrdered.toFixed(3),
      })),
    );
    await changeStatus(order.id, supplier.companyId, supplier.userId, 'PICKING');

    const result = await changeStatus(order.id, store.companyId, store.userId, 'CANCELLED');
    expect(result.status).toBe('forbidden_transition');
  });

  it('store_cancels_order_with_reason_before_picking', async () => {
    const { store, order } = await sentOrder(30);

    const result = await changeStatus(
      order.id,
      store.companyId,
      store.userId,
      'CANCELLED',
      'передумали',
    );

    expect(result).toMatchObject({ status: 'ok', orderStatus: 'CANCELLED' });
    const log = await prisma.orderStatusLog.findFirstOrThrow({
      where: { orderId: order.id, toStatus: 'CANCELLED' },
    });
    expect(log.comment).toBe('передумали');
  });

  it('order_keeps_delivery_date_comment_and_payment_method', async () => {
    const supplier = await makeSupplier(31);
    const store = await makeStore(31);
    await fillCart(store, [supplier.companyId]);

    const result = await checkout({
      storeId: store.companyId,
      locationId: store.locationId,
      cityId: store.cityId,
      userId: store.userId,
      deliveryDate: '2026-10-25',
      comment: 'привезти до обеда',
      paymentMethod: 'DEFERRED',
    });
    if (result.status !== 'created') throw new Error(result.status);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: result.orders[0]!.id } });
    expect(order.comment).toBe('привезти до обеда');
    expect(order.paymentMethod).toBe('DEFERRED');
    expect(order.deliveryDate?.toISOString().slice(0, 10)).toBe('2026-10-25');
  });

  it('order_of_another_company_is_not_reachable', async () => {
    const { order } = await sentOrder(19);
    const stranger = await makeStore(20);

    const result = await changeStatus(order.id, stranger.companyId, stranger.userId, 'CANCELLED');
    expect(result.status).toBe('not_found');
  });

  it('repeat_last_order_works_after_real_order', async () => {
    const { store, order } = await sentOrder(21);

    const repeated = await repeatLastOrder(store.companyId, store.locationId);
    expect(repeated.repeated).toBe(order.items.length);

    const groups = await getCartGroups(store.locationId, store.cityId);
    expect(groups[0]!.items).toHaveLength(order.items.length);
  });
});
