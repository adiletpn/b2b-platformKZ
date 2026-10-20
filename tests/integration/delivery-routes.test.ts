import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { orderFixture } from '../helpers/order-fixture';
import {
  getRoute,
  listDrivers,
  listRoutes,
  routeSheetHtml,
  saveRoute,
} from '@/lib/deliveries/routes';
import { kzDayKey } from '@/lib/format';

const prisma = createTestPrisma();

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('маршруты водителей (этап 3)', () => {
  it('route_keeps_manual_order_and_is_isolated', async () => {
    const first = await orderFixture(prisma, {
      index: 1,
      phones: ['7796', '7797'],
      binBase: 540,
      productBase: 330000,
      upTo: 'SHIPPED',
    });
    const foreign = await orderFixture(prisma, {
      index: 2,
      phones: ['7796', '7797'],
      binBase: 540,
      productBase: 330000,
      upTo: 'SHIPPED',
    });
    const today = kzDayKey(new Date());
    const [owner] = await listDrivers(first.supplierId);
    expect(owner).toBeDefined();

    // Чужую заявку в рейс не взять (правило 4), водитель — только свой сотрудник.
    expect(
      await saveRoute(first.supplierId, first.supplierUserId, {
        date: today,
        driverMembershipId: owner!.membershipId,
        orderIds: [foreign.orderId],
      }),
    ).toEqual({ status: 'order_unavailable', orderId: foreign.orderId });
    const [foreignDriver] = await listDrivers(foreign.supplierId);
    expect(
      (
        await saveRoute(first.supplierId, first.supplierUserId, {
          date: today,
          driverMembershipId: foreignDriver!.membershipId,
          orderIds: [first.orderId],
        })
      ).status,
    ).toBe('not_driver');

    const saved = await saveRoute(first.supplierId, first.supplierUserId, {
      date: today,
      driverMembershipId: owner!.membershipId,
      orderIds: [first.orderId],
    });
    if (saved.status !== 'ok') throw new Error(saved.status);
    expect(saved.number.startsWith('РЕЙС-')).toBe(true);

    // Заявка уже в рейсе — во второй рейс не попадёт.
    expect(
      (
        await saveRoute(first.supplierId, first.supplierUserId, {
          date: today,
          driverMembershipId: owner!.membershipId,
          orderIds: [first.orderId],
        })
      ).status,
    ).toBe('order_unavailable');

    const mine = await listRoutes(first.supplierId, { driverMembershipId: owner!.membershipId });
    expect(mine).toHaveLength(1);
    expect(mine[0]!.stops.map((stop) => [stop.position, stop.orderId])).toEqual([
      [1, first.orderId],
    ]);
    expect(await listRoutes(foreign.supplierId)).toEqual([]);
    expect(await getRoute(foreign.supplierId, saved.routeId)).toBeNull();

    // Маршрутный лист экранирует данные компаний.
    const html = routeSheetHtml({ ...mine[0]!, driver: '<b>x</b>' }, 'Поставщик', 'ru', {});
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});
