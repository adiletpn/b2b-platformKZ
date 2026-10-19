import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { registerCompany } from '@/lib/registration/register-company';
import { createOfferManually, lookupBarcode } from '@/lib/catalog/manual';
import { recordSwipe } from '@/lib/feed/swipe';
import { getFeed } from '@/lib/feed/query';
import { getOfferDetails } from '@/lib/feed/offer-details';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

/** Корректный EAN-13: контрольная цифра считается по основанию. */
function ean13(base: string) {
  const digits = base.padStart(12, '0').slice(0, 12).split('').map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return `${digits.join('')}${(10 - (sum % 10)) % 10}`;
}

async function createSupplier(index: number) {
  const user = await prisma.user.create({
    data: { phone: `+7798${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const result = await registerCompany({
    userId: user.id,
    bin: testPoolBin(780 + index),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);
  return { companyId: result.companyId, cityId: taraz.id };
}

async function createStore(index: number) {
  const user = await prisma.user.create({
    data: { phone: `+7799${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const result = await registerCompany({
    userId: user.id,
    bin: testPoolBin(790 + index),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 120' },
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);
  return { companyId: result.companyId, cityId: taraz.id, userId: user.id };
}

function validInput(barcode: string, overrides: Record<string, unknown> = {}) {
  return {
    barcode,
    nameRu: 'Молоко 1 л',
    nameKk: 'Сүт 1 л',
    unitCode: 'pcs',
    vatCode: 'vat-16',
    priceWithoutVat: '500',
    packSize: '12',
    minBatch: '12',
    stock: '100',
    ...overrides,
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ручной ввод карточки товара', () => {
  it('supplier_adds_offer_by_hand', async () => {
    const supplier = await createSupplier(1);
    const barcode = ean13('4870001000');

    const result = await createOfferManually(supplier.companyId, validInput(barcode));

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.created).toBe(true);

    const offer = await prisma.supplierOffer.findUniqueOrThrow({
      where: { id: result.offerId },
      include: { product: true, vatRate: true },
    });
    expect(offer.product.barcode).toBe(barcode);
    // Правило 1: цена с НДС считается по ставке справочника (16%).
    expect(offer.priceWithoutVat.toFixed(2)).toBe('500.00');
    expect(offer.priceWithVat.toFixed(2)).toBe('580.00');
    // Правило 2: количества до трёх знаков.
    expect(offer.packSize.toFixed(3)).toBe('12.000');
    expect(offer.stock.toFixed(3)).toBe('100.000');
  });

  it('wrong_barcode_name_or_amounts_are_refused', async () => {
    const supplier = await createSupplier(2);

    expect(await createOfferManually(supplier.companyId, validInput('1234567890123'))).toEqual({
      status: 'invalid_barcode',
    });

    expect(
      await createOfferManually(
        supplier.companyId,
        validInput(ean13('4870001001'), { nameKk: '  ' }),
      ),
    ).toEqual({ status: 'invalid_name' });

    expect(
      await createOfferManually(
        supplier.companyId,
        validInput(ean13('4870001002'), { vatCode: 'vat-999' }),
      ),
    ).toEqual({ status: 'invalid_vat' });

    expect(
      await createOfferManually(
        supplier.companyId,
        validInput(ean13('4870001003'), { minBatch: '0' }),
      ),
    ).toEqual({ status: 'invalid_amount' });
  });

  it('second_entry_updates_the_same_offer', async () => {
    const supplier = await createSupplier(3);
    const barcode = ean13('4870001004');

    await createOfferManually(supplier.companyId, validInput(barcode));
    const again = await createOfferManually(
      supplier.companyId,
      validInput(barcode, { priceWithoutVat: '600', stock: '50' }),
    );

    expect(again.status).toBe('ok');
    if (again.status !== 'ok') return;
    expect(again.created).toBe(false);
    expect(await prisma.supplierOffer.count({ where: { supplierId: supplier.companyId } })).toBe(1);

    const offer = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: again.offerId } });
    expect(offer.priceWithVat.toFixed(2)).toBe('696.00');
  });

  it('barcode_lookup_fills_card_from_platform_catalog', async () => {
    const first = await createSupplier(4);
    const second = await createSupplier(5);
    const barcode = ean13('4870001005');

    await createOfferManually(
      first.companyId,
      validInput(barcode, { brand: 'Айналайын', country: 'Казахстан' }),
    );

    const lookup = await lookupBarcode(barcode);
    expect(lookup?.found).toBe(true);
    expect(lookup?.nameRu).toBe('Молоко 1 л');
    expect(lookup?.brand).toBe('Айналайын');
    expect(lookup?.unitCode).toBe('pcs');

    // Раздел 3.2 ТЗ: один штрихкод — один товар, у второго поставщика своё предложение.
    const offer = await createOfferManually(
      second.companyId,
      validInput(barcode, { priceWithoutVat: '450' }),
    );
    expect(offer.status).toBe('ok');
    expect(await prisma.product.count({ where: { barcode } })).toBe(1);
  });

  it('unknown_barcode_returns_empty_card', async () => {
    expect((await lookupBarcode(ean13('4870009999')))?.found).toBe(false);
    expect(await lookupBarcode('1234567890123')).toBeNull();
  });
});

describe('избранное и сравнение цен', () => {
  it('swipe_up_marks_offer_as_favorite', async () => {
    const supplier = await createSupplier(6);
    const store = await createStore(6);
    const barcode = ean13('4870002000');
    const created = await createOfferManually(supplier.companyId, validInput(barcode));
    if (created.status !== 'ok') throw new Error(created.status);

    const location = await prisma.location.findFirstOrThrow({
      where: { companyId: store.companyId },
    });
    const added = await recordSwipe(store.companyId, location.id, created.offerId, 'FAV');

    // Свайп вверх только помечает товар: в корзину он не попадает.
    expect(added).toEqual({ added: false });
    expect(await prisma.cartItem.count()).toBe(0);

    const feed = await getFeed(store.companyId, store.cityId, {
      forSwipe: false,
      filters: { onlyFavorites: true },
    });
    expect(feed.map((offer) => offer.id)).toEqual([created.offerId]);
    expect(feed[0]!.isFavorite).toBe(true);
  });

  it('details_compare_prices_of_city_suppliers', async () => {
    const cheap = await createSupplier(7);
    const pricey = await createSupplier(8);
    const store = await createStore(7);
    const barcode = ean13('4870002001');

    const cheapOffer = await createOfferManually(
      cheap.companyId,
      validInput(barcode, { priceWithoutVat: '400' }),
    );
    const priceyOffer = await createOfferManually(
      pricey.companyId,
      validInput(barcode, { priceWithoutVat: '600' }),
    );
    if (cheapOffer.status !== 'ok' || priceyOffer.status !== 'ok') throw new Error('каталог');

    const details = await getOfferDetails(store.companyId, store.cityId, priceyOffer.offerId);

    expect(details).not.toBeNull();
    expect(details!.barcode).toBe(barcode);
    // Сравнение идёт по цене: дешёвое предложение первым.
    expect(details!.offers.map((offer) => offer.offerId)).toEqual([
      cheapOffer.offerId,
      priceyOffer.offerId,
    ]);
    expect(details!.offers[1]!.isCurrent).toBe(true);
    expect(details!.offers[0]!.priceWithVat).toBe('464.00');
  });

  it('offer_of_supplier_outside_city_is_not_shown', async () => {
    const supplier = await createSupplier(9);
    const store = await createStore(8);
    const barcode = ean13('4870002002');
    const created = await createOfferManually(supplier.companyId, validInput(barcode));
    if (created.status !== 'ok') throw new Error(created.status);

    // Правило 4 и раздел 3.9: поставщик больше не возит в город точки.
    await prisma.deliveryZone.deleteMany({ where: { supplierId: supplier.companyId } });

    expect(await getOfferDetails(store.companyId, store.cityId, created.offerId)).toBeNull();
  });
});
