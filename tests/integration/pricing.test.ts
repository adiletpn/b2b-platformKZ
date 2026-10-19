import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { effectivePrices, isNewProduct } from '@/lib/pricing/price';
import { getFeed } from '@/lib/feed/query';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function setup(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7760${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7761${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(450 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(451 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 30' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(140000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 1 }),
      ]),
    ),
  );

  const offer = await prisma.supplierOffer.findFirstOrThrow({
    where: { supplierId: supplier.companyId },
  });
  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: store.companyId },
  });

  return {
    supplierId: supplier.companyId,
    storeId: store.companyId,
    cityId: taraz.id,
    locationId: location.id,
    offer,
  };
}

async function priceFor(context: Awaited<ReturnType<typeof setup>>, quantity?: string) {
  const map = await effectivePrices(
    [
      {
        id: context.offer.id,
        priceWithVat: context.offer.priceWithVat.toString(),
        supplierId: context.supplierId,
      },
    ],
    context.storeId,
    quantity ? new Map([[context.offer.id, new Decimal(quantity)]]) : undefined,
  );
  return map.get(context.offer.id)!;
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('прайсы и скидки', () => {
  it('base_price_is_used_when_no_rules_exist', async () => {
    const context = await setup(1);
    const price = await priceFor(context);

    // 100 ₸ без НДС и ставка 16% дают 116 ₸.
    expect(price.priceWithVat).toBe('116.00');
    expect(price.discountPercent).toBe('0.00');
    expect(price.isPromo).toBe(false);
  });

  it('individual_price_list_overrides_base_one', async () => {
    const context = await setup(2);

    const base = await prisma.priceList.create({
      data: { supplierId: context.supplierId, name: 'Базовый', isDefault: true },
    });
    await prisma.priceRule.create({
      data: { priceListId: base.id, offerId: context.offer.id, discountPercent: '5' },
    });

    const personal = await prisma.priceList.create({
      data: {
        supplierId: context.supplierId,
        name: 'Для сети',
        storeIds: [context.storeId],
      },
    });
    await prisma.priceRule.create({
      data: { priceListId: personal.id, offerId: context.offer.id, priceWithVat: '99.00' },
    });

    const price = await priceFor(context);
    // Индивидуальный прайс важнее базового, даже если базовая скидка тоже действует.
    expect(price.priceWithVat).toBe('99.00');
  });

  it('volume_discount_applies_from_minimum_quantity', async () => {
    const context = await setup(3);
    const list = await prisma.priceList.create({
      data: { supplierId: context.supplierId, name: 'Объём', isDefault: true },
    });
    await prisma.priceRule.create({
      data: {
        priceListId: list.id,
        offerId: context.offer.id,
        discountPercent: '10',
        minQuantity: '12',
      },
    });

    expect((await priceFor(context, '5')).priceWithVat).toBe('116.00');
    expect((await priceFor(context, '12')).priceWithVat).toBe('104.40');
  });

  it('promo_is_limited_by_dates', async () => {
    const context = await setup(4);
    const list = await prisma.priceList.create({
      data: { supplierId: context.supplierId, name: 'Акции', isDefault: true },
    });

    const past = new Date();
    past.setDate(past.getDate() - 10);
    await prisma.priceRule.create({
      data: {
        priceListId: list.id,
        offerId: context.offer.id,
        discountPercent: '20',
        isPromo: true,
        validFrom: past,
        validTo: past,
      },
    });

    // Акция закончилась — цена базовая.
    expect((await priceFor(context)).isPromo).toBe(false);

    const future = new Date();
    future.setDate(future.getDate() + 10);
    await prisma.priceRule.updateMany({
      where: { priceListId: list.id },
      data: { validTo: future },
    });

    const active = await priceFor(context);
    expect(active.isPromo).toBe(true);
    expect(active.priceWithVat).toBe('92.80');
    expect(active.discountPercent).toBe('20.00');
  });

  it('price_list_of_another_store_is_not_applied', async () => {
    const context = await setup(5);
    const stranger = await setup(6);

    const personal = await prisma.priceList.create({
      data: {
        supplierId: context.supplierId,
        name: 'Чужой прайс',
        storeIds: [stranger.storeId],
      },
    });
    await prisma.priceRule.create({
      data: { priceListId: personal.id, offerId: context.offer.id, priceWithVat: '10.00' },
    });

    expect((await priceFor(context)).priceWithVat).toBe('116.00');
  });
});

describe('бейджи ленты', () => {
  it('feed_marks_promo_new_and_cheapest_offers', async () => {
    const context = await setup(7);
    const list = await prisma.priceList.create({
      data: { supplierId: context.supplierId, name: 'Акции', isDefault: true },
    });
    await prisma.priceRule.create({
      data: {
        priceListId: list.id,
        offerId: context.offer.id,
        discountPercent: '15',
        isPromo: true,
      },
    });

    const feed = await getFeed(context.storeId, context.cityId, { forSwipe: false });
    const item = feed.find((offer) => offer.id === context.offer.id)!;

    expect(item.isPromo).toBe(true);
    expect(item.isNew).toBe(true);
    expect(item.priceWithVat).toBe('98.60');
    expect(item.basePriceWithVat).toBe('116.00');
  });

  it('feed_sorts_promotions_first', async () => {
    const context = await setup(8);
    await importCatalog(
      context.supplierId,
      toArrayBuffer(
        await buildCatalogXlsx([
          validRow(141000, { nameRu: 'Яблоки', priceWithoutVat: '100.00' }),
          validRow(141001, { nameRu: 'Абрикосы', priceWithoutVat: '100.00' }),
        ]),
      ),
    );

    const promoOffer = await prisma.supplierOffer.findFirstOrThrow({
      where: { supplierId: context.supplierId, product: { nameRu: 'Яблоки' } },
    });
    const list = await prisma.priceList.create({
      data: { supplierId: context.supplierId, name: 'Акции', isDefault: true },
    });
    await prisma.priceRule.create({
      data: { priceListId: list.id, offerId: promoOffer.id, discountPercent: '10', isPromo: true },
    });

    const feed = await getFeed(context.storeId, context.cityId, { forSwipe: false });
    // Акция идёт первой, несмотря на алфавит.
    expect(feed[0]!.id).toBe(promoOffer.id);
  });

  it('feed_filters_show_only_promotions', async () => {
    const context = await setup(9);
    const list = await prisma.priceList.create({
      data: { supplierId: context.supplierId, name: 'Акции', isDefault: true },
    });
    await prisma.priceRule.create({
      data: {
        priceListId: list.id,
        offerId: context.offer.id,
        discountPercent: '10',
        isPromo: true,
      },
    });

    const all = await getFeed(context.storeId, context.cityId, { forSwipe: false });
    const promos = await getFeed(context.storeId, context.cityId, {
      forSwipe: false,
      filters: { onlyPromo: true },
    });

    expect(all.length).toBeGreaterThanOrEqual(promos.length);
    expect(promos.every((offer) => offer.isPromo)).toBe(true);
  });
});

describe('признак новинки', () => {
  it('product_is_new_for_thirty_days', () => {
    const now = new Date('2026-10-19T00:00:00.000Z');
    const recent = new Date('2026-10-01T00:00:00.000Z');
    const old = new Date('2026-08-01T00:00:00.000Z');

    expect(isNewProduct(recent, now)).toBe(true);
    expect(isNewProduct(old, now)).toBe(false);
  });
});
