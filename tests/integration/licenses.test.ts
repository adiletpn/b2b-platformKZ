import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { orderFixture } from '../helpers/order-fixture';
import { getFeed } from '@/lib/feed/query';
import { getOfferDetails } from '@/lib/feed/offer-details';
import { recordSwipe } from '@/lib/feed/swipe';
import { checkout } from '@/lib/orders/checkout';
import { saveLicense } from '@/lib/licenses/licenses';

const prisma = createTestPrisma();

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('лицензируемые товары (раздел 2 ТЗ)', () => {
  it('licensed_goods_visible_only_when_both_sides_hold_valid_license', async () => {
    const context = await orderFixture(prisma, {
      index: 1,
      phones: ['7749', '7740'],
      binBase: 600,
      productBase: 320000,
      upTo: 'SENT',
    });
    const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: context.offerId } });
    await prisma.product.update({ where: { id: offer.productId }, data: { isLicensed: true } });
    const visible = async () =>
      (await getFeed(context.storeId, context.cityId, { forSwipe: false })).length;

    expect(await visible()).toBe(0);
    expect(await getOfferDetails(context.storeId, context.cityId, offer.id)).toBeNull();
    expect(await recordSwipe(context.storeId, context.locationId, offer.id, 'LIKE')).toEqual({
      added: false,
      licenseRequired: true,
    });

    // Лицензия только у магазина: у поставщика без лицензии товар всё ещё скрыт.
    expect(await saveLicense(context.storeId, { number: 'KZ-ALC-0001', validUntil: '' })).toEqual({
      status: 'ok',
    });
    expect(await visible()).toBe(0);

    await saveLicense(context.supplierId, { number: 'KZ-ALC-0002', validUntil: '2099-12-31' });
    expect(await visible()).toBe(1);
    expect(await recordSwipe(context.storeId, context.locationId, offer.id, 'LIKE')).toEqual({
      added: true,
    });

    // Лицензия магазина истекла, пока товар лежал в корзине: заявка не уходит.
    await saveLicense(context.storeId, { number: 'KZ-ALC-0001', validUntil: '2020-01-01' });
    expect(await visible()).toBe(0);
    expect(
      await checkout({
        storeId: context.storeId,
        locationId: context.locationId,
        cityId: context.cityId,
        userId: context.storeUserId,
      }),
    ).toMatchObject({ status: 'license_required' });
  });

  it('license_input_is_validated', async () => {
    const context = await orderFixture(prisma, {
      index: 2,
      phones: ['7749', '7740'],
      binBase: 600,
      productBase: 320000,
      upTo: 'SENT',
    });
    expect(await saveLicense(context.storeId, { number: 'x'.repeat(51), validUntil: '' })).toEqual({
      status: 'invalid_number',
    });
    expect(
      await saveLicense(context.storeId, { number: 'KZ-1', validUntil: '31.12.2030' }),
    ).toEqual({ status: 'invalid_date' });
    // Пустой номер снимает лицензию.
    await saveLicense(context.storeId, { number: 'KZ-1', validUntil: '' });
    await saveLicense(context.storeId, { number: '', validUntil: '' });
    expect(await prisma.companyLicense.count()).toBe(0);
  });
});
