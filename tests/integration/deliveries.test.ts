import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { orderFixture } from '../helpers/order-fixture';
import {
  attachSignedWaybillPhoto,
  listDeliveries,
  markDelivered,
  waybillForDriver,
} from '@/lib/deliveries/deliveries';

const prisma = createTestPrisma();
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

const fixture = (index: number) =>
  orderFixture(prisma, {
    index,
    phones: ['7789', '7780'],
    binBase: 600,
    productBase: 270000,
    upTo: 'SHIPPED',
  });

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('доставки водителя (разделы 1.2 и 3.5 ТЗ)', () => {
  it('driver_sees_shipped_order_with_address_and_waybill', async () => {
    const context = await fixture(1);
    const other = await fixture(2);

    const rows = await listDeliveries(context.supplierId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orderId: context.orderId, status: 'SHIPPED' });
    expect(rows[0]!.address).toContain('Демонстрационная, 99');
    expect(rows[0]!.waybillId).not.toBeNull();
    // Правило 4: чужие доставки не видны, чужую накладную не открыть.
    expect(rows.some((row) => row.orderId === other.orderId)).toBe(false);
    expect(await waybillForDriver(context.orderId, other.supplierId)).toBeNull();
    expect(await waybillForDriver(context.orderId, context.supplierId)).not.toBeNull();
  });

  it('driver_marks_delivered_and_attaches_signed_waybill_photo', async () => {
    const context = await fixture(3);

    const photo = await attachSignedWaybillPhoto({
      orderId: context.orderId,
      supplierId: context.supplierId,
      userId: context.supplierUserId,
      fileName: 'накладная.png',
      data: PNG,
    });
    expect(photo.status).toBe('ok');
    expect(
      await markDelivered(context.orderId, context.supplierId, context.supplierUserId),
    ).toMatchObject({
      status: 'ok',
    });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: context.orderId } });
    expect(order.status).toBe('DELIVERED');
    // Фото видит и магазин: это файл заявки.
    const files = await prisma.attachment.findMany({ where: { orderId: context.orderId } });
    expect(files).toHaveLength(1);
    expect((await listDeliveries(context.supplierId))[0]!.photos).toBe(1);
  });

  it('store_cannot_use_driver_actions', async () => {
    const context = await fixture(4);
    expect(
      await attachSignedWaybillPhoto({
        orderId: context.orderId,
        supplierId: context.storeId,
        userId: context.storeUserId,
        fileName: 'x.png',
        data: PNG,
      }),
    ).toEqual({ status: 'not_found' });
    expect(await listDeliveries(context.storeId)).toEqual([]);
  });
});
