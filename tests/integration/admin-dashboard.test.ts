import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { recordSwipe } from '@/lib/feed/swipe';
import { checkout } from '@/lib/orders/checkout';
import { confirmOrder } from '@/lib/orders/workflow';
import { getDashboard, listDisputes, resolveDispute } from '@/lib/admin/dashboard';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

/** Подтверждённая заявка магазина к поставщику: даёт оборот для дашборда. */
async function confirmedOrder(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7790${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7791${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(650 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(651 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 70' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(180000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 10 }),
      ]),
    ),
  );

  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: store.companyId },
  });
  const offer = await prisma.supplierOffer.findFirstOrThrow({
    where: { supplierId: supplier.companyId },
  });
  await recordSwipe(store.companyId, location.id, offer.id, 'LIKE');

  const created = await checkout({
    storeId: store.companyId,
    locationId: location.id,
    cityId: taraz.id,
    userId: storeUser.id,
  });
  if (created.status !== 'created') throw new Error(created.status);
  const orderId = created.orders[0]!.id;

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  await confirmOrder(
    orderId,
    supplier.companyId,
    supplierUser.id,
    order.items.map((item) => ({
      orderItemId: item.id,
      quantityConfirmed: item.quantityOrdered.toFixed(3),
    })),
  );

  return {
    orderId,
    number: order.number,
    total: new Decimal(order.totalWithVat.toString()),
    supplier: { id: supplier.companyId, userId: supplierUser.id },
    store: { id: store.companyId, userId: storeUser.id },
  };
}

async function moderator() {
  return prisma.adminUser.findFirstOrThrow({ where: { role: 'MODERATOR' } });
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.adminAuditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('дашборд платформы', () => {
  it('dashboard_counts_companies_orders_and_turnover', async () => {
    const context = await confirmedOrder(1);

    const metrics = await getDashboard();

    expect(metrics.newCompaniesToday).toBe(2);
    expect(metrics.activeStores).toBe(1);
    expect(metrics.activeSuppliers).toBe(1);
    expect(metrics.ordersToday).toBe(1);
    // Правило 1: оборот считается Decimal с двумя знаками.
    expect(metrics.gmvToday).toBe(context.total.toFixed(2));
    expect(metrics.gmvMonth).toBe(context.total.toFixed(2));
  });

  it('dashboard_shows_conversion_and_cities', async () => {
    await confirmedOrder(2);

    const metrics = await getDashboard();

    // Один магазин зарегистрировался и сделал заявку — конверсия 100%.
    expect(metrics.conversion).toBe('100.00');
    expect(metrics.byCity).toEqual([{ city: 'Тараз', orders: 1, gmv: metrics.gmvMonth }]);
  });

  it('dashboard_is_empty_on_clean_platform', async () => {
    const metrics = await getDashboard();

    expect(metrics.ordersToday).toBe(0);
    expect(metrics.gmvToday).toBe('0.00');
    expect(metrics.conversion).toBe('0.00');
    expect(metrics.byCity).toEqual([]);
    expect(metrics.openDisputes).toBe(0);
  });
});

describe('разбор споров администратором', () => {
  async function disputedOrder(index: number) {
    const context = await confirmedOrder(index);
    await prisma.order.update({
      where: { id: context.orderId },
      data: { status: 'DISPUTE', disputeReason: 'магазин не согласен с расхождением' },
    });
    return context;
  }

  it('dispute_is_listed_with_both_sides', async () => {
    const context = await disputedOrder(3);

    const [row, ...rest] = await listDisputes();

    expect(rest).toHaveLength(0);
    expect(row!.orderId).toBe(context.orderId);
    expect(row!.number).toBe(context.number);
    expect(row!.reason).toBe('магазин не согласен с расхождением');
    expect(row!.total).toBe(context.total.toFixed(2));

    const metrics = await getDashboard();
    expect(metrics.openDisputes).toBe(1);
  });

  it('admin_resolves_dispute_and_notifies_both_sides', async () => {
    const context = await disputedOrder(4);
    const admin = await moderator();

    expect(
      await resolveDispute(admin.id, context.orderId, 'PAID', 'оплата подтверждена банком'),
    ).toEqual({
      status: 'ok',
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    expect(order.status).toBe('PAID');

    const log = await prisma.orderStatusLog.findFirstOrThrow({
      where: { orderId: context.orderId, fromStatus: 'DISPUTE' },
    });
    expect(log.toStatus).toBe('PAID');
    expect(log.comment).toBe('оплата подтверждена банком');

    const notified = await prisma.notification.findMany({
      where: { event: 'order_status_changed' },
      select: { companyId: true },
    });
    expect(new Set(notified.map((row) => row.companyId))).toEqual(
      new Set([context.store.id, context.supplier.id]),
    );

    // Критерий этапа 1: решение администратора попадает в журнал аудита.
    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action: 'dispute_resolved' },
    });
    expect(audit.entityId).toBe(context.orderId);
    expect(audit.reason).toBe('оплата подтверждена банком');
  });

  it('dispute_resolution_requires_comment', async () => {
    const context = await disputedOrder(5);
    const admin = await moderator();

    expect(await resolveDispute(admin.id, context.orderId, 'CANCELLED', '   ')).toEqual({
      status: 'comment_required',
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    expect(order.status).toBe('DISPUTE');
  });

  it('order_without_dispute_cannot_be_resolved', async () => {
    const context = await confirmedOrder(6);
    const admin = await moderator();

    expect(await resolveDispute(admin.id, context.orderId, 'PAID', 'причина')).toEqual({
      status: 'not_found',
    });
  });
});
