import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { getFeed } from '@/lib/feed/query';
import { getCartGroups, setCartItem } from '@/lib/cart/cart';
import { recordSwipe, repeatLastOrder, undoLastSwipe } from '@/lib/feed/swipe';

const prisma = createTestPrisma();

async function city(code: string) {
  return prisma.city.findUniqueOrThrow({ where: { code } });
}

async function makeSupplier(phone: string, bin: string, cityCodes: string[], products = 3) {
  const user = await prisma.user.create({ data: { phone } });
  const cities = await Promise.all(cityCodes.map(city));
  const result = await registerCompany({
    userId: user.id,
    bin,
    type: 'SUPPLIER',
    deliveryCityIds: cities.map((item) => item.id),
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);

  const rows = Array.from({ length: products }, (_, index) =>
    validRow(Number(bin.slice(-4)) * 100 + index),
  );
  await importCatalog(result.companyId, toArrayBuffer(await buildCatalogXlsx(rows)));
  return result.companyId;
}

async function makeStore(phone: string, bin: string, cityCode: string) {
  const user = await prisma.user.create({ data: { phone } });
  const target = await city(cityCode);
  const result = await registerCompany({
    userId: user.id,
    bin,
    type: 'STORE',
    location: { cityId: target.id, address: 'ул. Демонстрационная, 1' },
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);

  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: result.companyId },
  });
  return { companyId: result.companyId, locationId: location.id, cityId: target.id };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('лента магазина', () => {
  it('feed_shows_only_suppliers_delivering_to_store_city', async () => {
    const taraz = await makeSupplier('+77030000001', '120340001230', ['taraz']);
    await makeSupplier('+77030000002', '150640004569', ['astana']);
    const store = await makeStore('+77030000003', '140240003217', 'taraz');

    const offers = await getFeed(store.companyId, store.cityId, { forSwipe: false });

    expect(offers.length).toBeGreaterThan(0);
    expect([...new Set(offers.map((offer) => offer.supplierId))]).toEqual([taraz]);
  });

  it('feed_returns_product_photo_and_supplier_rating', async () => {
    const supplier = await makeSupplier('+77030000050', '120340001230', ['taraz']);
    const store = await makeStore('+77030000051', '140240003217', 'taraz');

    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId: supplier } });
    await prisma.product.update({
      where: { id: offer.productId },
      data: { photoUrls: ['/products/dairy.svg'] },
    });

    const before = await getFeed(store.companyId, store.cityId, { forSwipe: false });
    const shown = before.find((item) => item.id === offer.id)!;
    expect(shown.photoUrl).toBe('/products/dairy.svg');
    // Оценок ещё нет: карточка покажет «мало оценок».
    expect(shown.supplierRating).toBeNull();
    expect(shown.supplierRatingCount).toBe(0);

    const order = await prisma.order.create({
      data: {
        number: 'RATING-1',
        storeId: store.companyId,
        supplierId: supplier,
        locationId: store.locationId,
        status: 'CLOSED',
      },
    });
    await prisma.rating.create({
      data: {
        orderId: order.id,
        authorCompanyId: store.companyId,
        targetCompanyId: supplier,
        criteria: { quality: 5 },
        score: '4.50',
      },
    });

    const after = await getFeed(store.companyId, store.cityId, { forSwipe: false });
    const rated = after.find((item) => item.id === offer.id)!;
    expect(rated.supplierRating).toBe('4.50');
    expect(rated.supplierRatingCount).toBe(1);
  });

  it('feed_is_empty_when_nobody_delivers_to_city', async () => {
    await makeSupplier('+77030000004', '120340001230', ['astana']);
    const store = await makeStore('+77030000005', '140240003217', 'taraz');

    expect(await getFeed(store.companyId, store.cityId, { forSwipe: false })).toEqual([]);
  });

  it('swipe_feed_hides_zero_stock_but_list_keeps_it', async () => {
    const supplier = await makeSupplier('+77030000006', '120340001230', ['taraz']);
    const store = await makeStore('+77030000007', '140240003217', 'taraz');
    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId: supplier } });
    await prisma.supplierOffer.update({ where: { id: offer.id }, data: { stock: '0' } });

    const swipe = await getFeed(store.companyId, store.cityId, { forSwipe: true });
    const list = await getFeed(store.companyId, store.cityId, { forSwipe: false });

    expect(swipe.map((item) => item.id)).not.toContain(offer.id);
    expect(list.map((item) => item.id)).toContain(offer.id);
    expect(list.find((item) => item.id === offer.id)!.inStock).toBe(false);
  });
});

describe('свайп и корзина', () => {
  it('swipe_right_adds_offer_to_cart_with_min_batch', async () => {
    const supplier = await makeSupplier('+77030000008', '120340001230', ['taraz']);
    const store = await makeStore('+77030000009', '140240003217', 'taraz');
    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId: supplier } });

    await recordSwipe(store.companyId, store.locationId, offer.id, 'LIKE');

    const groups = await getCartGroups(store.locationId, store.cityId);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items[0]!.quantity).toBe(offer.minBatch.toFixed(3));
  });

  it('swipe_left_hides_offer_from_swipe_feed', async () => {
    const supplier = await makeSupplier('+77030000010', '120340001230', ['taraz']);
    const store = await makeStore('+77030000011', '140240003217', 'taraz');
    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId: supplier } });

    await recordSwipe(store.companyId, store.locationId, offer.id, 'SKIP');

    const swipe = await getFeed(store.companyId, store.cityId, { forSwipe: true });
    expect(swipe.map((item) => item.id)).not.toContain(offer.id);
  });

  it('undo_returns_card_and_removes_it_from_cart', async () => {
    const supplier = await makeSupplier('+77030000012', '120340001230', ['taraz']);
    const store = await makeStore('+77030000013', '140240003217', 'taraz');
    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId: supplier } });

    await recordSwipe(store.companyId, store.locationId, offer.id, 'LIKE');
    const undone = await undoLastSwipe(store.companyId, store.locationId);

    expect(undone.undone).toMatchObject({ offerId: offer.id, action: 'LIKE' });
    expect(await getCartGroups(store.locationId, store.cityId)).toEqual([]);
    const swipe = await getFeed(store.companyId, store.cityId, { forSwipe: true });
    expect(swipe.map((item) => item.id)).toContain(offer.id);
  });

  it('cart_is_split_by_supplier_with_totals', async () => {
    const first = await makeSupplier('+77030000014', '120340001230', ['taraz']);
    const second = await makeSupplier('+77030000015', '150640004569', ['taraz']);
    const third = await makeSupplier('+77030000016', '130540001359', ['taraz']);
    const store = await makeStore('+77030000017', '140240003217', 'taraz');

    for (const supplierId of [first, second, third]) {
      const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId } });
      await recordSwipe(store.companyId, store.locationId, offer.id, 'LIKE');
    }

    const groups = await getCartGroups(store.locationId, store.cityId);
    expect(groups).toHaveLength(3);
    for (const group of groups) {
      const item = group.items[0]!;
      const expected = new Decimal(item.priceWithVat).times(item.quantity).toFixed(2);
      expect(group.total).toBe(expected);
    }
  });

  it('cart_shows_how_much_is_missing_to_minimum_order', async () => {
    const supplier = await makeSupplier('+77030000018', '120340001230', ['taraz']);
    const store = await makeStore('+77030000019', '140240003217', 'taraz');
    await prisma.deliveryZone.updateMany({
      where: { supplierId: supplier },
      data: { minOrderAmount: '99999999.00' },
    });

    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId: supplier } });
    await recordSwipe(store.companyId, store.locationId, offer.id, 'LIKE');

    const group = (await getCartGroups(store.locationId, store.cityId))[0]!;
    expect(group.meetsMinimum).toBe(false);
    expect(group.missingToMinimum).toBe(new Decimal('99999999.00').minus(group.total).toFixed(2));
  });

  it('cart_quantity_is_rounded_up_to_pack_size', async () => {
    const supplier = await makeSupplier('+77030000020', '120340001230', ['taraz']);
    const store = await makeStore('+77030000021', '140240003217', 'taraz');
    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId: supplier } });

    // Кратность в фикстуре — 12.
    const result = await setCartItem(store.locationId, offer.id, new Decimal('13'));
    expect(result.quantity).toBe('24.000');
  });

  it('cart_reports_when_quantity_was_rounded', async () => {
    const supplier = await makeSupplier('+77030000040', '120340001230', ['taraz']);
    const store = await makeStore('+77030000041', '140240003217', 'taraz');
    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId: supplier } });

    // Кратность в фикстуре — 12.
    const rounded = await setCartItem(store.locationId, offer.id, new Decimal('13'));
    const exact = await setCartItem(store.locationId, offer.id, new Decimal('24'));

    expect(rounded).toMatchObject({ quantity: '24.000', rounded: true });
    expect(exact).toMatchObject({ quantity: '24.000', rounded: false });
  });

  it('repeat_last_order_puts_previous_items_back_to_cart', async () => {
    const supplier = await makeSupplier('+77030000022', '120340001230', ['taraz']);
    const store = await makeStore('+77030000023', '140240003217', 'taraz');
    const offers = await prisma.supplierOffer.findMany({ where: { supplierId: supplier } });

    await prisma.order.create({
      data: {
        number: 'TEST-1',
        storeId: store.companyId,
        supplierId: supplier,
        locationId: store.locationId,
        status: 'CLOSED',
        items: {
          create: offers.slice(0, 2).map((offer) => ({
            offerId: offer.id,
            quantityOrdered: '24.000',
            priceWithoutVat: offer.priceWithoutVat,
            priceWithVat: offer.priceWithVat,
            vatRateValue: '16.00',
          })),
        },
      },
    });

    const result = await repeatLastOrder(store.companyId, store.locationId);

    expect(result.repeated).toBe(2);
    const groups = await getCartGroups(store.locationId, store.cityId);
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[0]!.items[0]!.quantity).toBe('24.000');
  });

  it('repeat_last_order_without_history_changes_nothing', async () => {
    const store = await makeStore('+77030000024', '140240003217', 'taraz');
    expect(await repeatLastOrder(store.companyId, store.locationId)).toEqual({ repeated: 0 });
  });

  it('cart_of_one_store_is_not_visible_to_another', async () => {
    const supplier = await makeSupplier('+77030000025', '120340001230', ['taraz']);
    const first = await makeStore('+77030000026', '140240003217', 'taraz');
    const second = await makeStore('+77030000027', '210540009877', 'taraz');
    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId: supplier } });

    await recordSwipe(first.companyId, first.locationId, offer.id, 'LIKE');

    expect(await getCartGroups(first.locationId, first.cityId)).toHaveLength(1);
    expect(await getCartGroups(second.locationId, second.cityId)).toEqual([]);
  });
});
