import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { registerCompany } from '@/lib/registration/register-company';
import { getGeography } from '@/lib/feed/geography';
import { notify, NOTIFICATION_CHANNELS } from '@/mocks/notifications';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function cities() {
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  // Соседний город — из той же области, что и Тараз.
  const neighbour = await prisma.city.findFirstOrThrow({
    where: { regionId: taraz.regionId, id: { not: taraz.id } },
  });
  const other = await prisma.city.findUniqueOrThrow({ where: { code: 'almaty' } });
  return { taraz, neighbour, other };
}

async function createSupplier(index: number, cityIds: string[], withWarehouse?: string) {
  const user = await prisma.user.create({
    data: { phone: `+7770${String(index).padStart(7, '0')}` },
  });
  const result = await registerCompany({
    userId: user.id,
    bin: testPoolBin(800 + index),
    type: 'SUPPLIER',
    deliveryCityIds: cityIds,
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);

  if (withWarehouse) {
    await prisma.location.create({
      data: {
        companyId: result.companyId,
        cityId: withWarehouse,
        type: 'WAREHOUSE',
        address: 'ул. Складская, 1',
      },
    });
  }
  return result.companyId;
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('города и география', () => {
  it('city_points_show_warehouses_of_delivering_suppliers', async () => {
    const { taraz } = await cities();
    const supplierId = await createSupplier(1, [taraz.id], taraz.id);

    const geography = await getGeography(taraz.id);

    expect(geography.points).toEqual([
      {
        companyId: supplierId,
        companyName: expect.any(String),
        type: 'WAREHOUSE',
        address: 'ул. Складская, 1',
        deliversToCity: true,
      },
    ]);
  });

  it('nearby_city_suppliers_are_marked_as_not_delivering', async () => {
    const { taraz, neighbour } = await cities();
    await createSupplier(2, [taraz.id]);
    const nearbyId = await createSupplier(3, [neighbour.id]);

    const geography = await getGeography(taraz.id);

    // Раздел 3.9 ТЗ: поставщик соседнего города виден с пометкой.
    expect(geography.nearby.map((row) => row.companyId)).toEqual([nearbyId]);
    expect(geography.nearby[0]!.deliversToYourCity).toBe(false);
    expect(geography.nearby[0]!.cityNameRu).toBe(neighbour.nameRu);
  });

  it('supplier_of_another_region_is_not_nearby', async () => {
    const { taraz, other } = await cities();
    await createSupplier(4, [other.id]);

    expect((await getGeography(taraz.id)).nearby).toEqual([]);
  });

  it('supplier_delivering_to_city_is_not_listed_as_nearby', async () => {
    const { taraz, neighbour } = await cities();
    await createSupplier(5, [taraz.id, neighbour.id]);

    const geography = await getGeography(taraz.id);
    expect(geography.nearby).toEqual([]);
  });
});

describe('каналы уведомлений', () => {
  it('notification_goes_only_to_chosen_channels', async () => {
    const { taraz } = await cities();
    const supplierId = await createSupplier(6, [taraz.id]);

    await prisma.company.update({
      where: { id: supplierId },
      data: { notificationChannels: ['telegram'] },
    });
    await notify(supplierId, 'order_created', { number: 'ЗАЯВ-1', total: '100.00' });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { companyId: supplierId },
    });
    expect(notification.channels).toEqual(['telegram']);
  });

  it('by_default_every_channel_is_on', async () => {
    const { taraz } = await cities();
    const supplierId = await createSupplier(7, [taraz.id]);

    await notify(supplierId, 'order_created', { number: 'ЗАЯВ-2', total: '100.00' });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { companyId: supplierId },
    });
    expect(notification.channels).toEqual([...NOTIFICATION_CHANNELS]);
  });
});
