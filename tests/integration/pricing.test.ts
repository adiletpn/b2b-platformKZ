import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { registerCompany } from '@/lib/registration/register-company';
import { createOfferManually } from '@/lib/catalog/manual';
import { applyBalanceChange } from '@/lib/stock/balance';
import { getLabels, repriceAll, setMarkup } from '@/lib/stock/pricing';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

function ean13(base: string) {
  const digits = base.padStart(12, '0').slice(0, 12).split('').map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return `${digits.join('')}${(10 - (sum % 10)) % 10}`;
}

/** Магазин с товаром на остатке и себестоимостью 100 ₸. */
async function storeWithCost(index: number, categoryCode?: string) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7777${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7778${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(930 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(931 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 160' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  const offer = await createOfferManually(supplier.companyId, {
    barcode: ean13(`48700040000${index}`),
    nameRu: 'Товар с ценником',
    nameKk: 'Бағажапсырмасы бар тауар',
    unitCode: 'pcs',
    vatCode: 'vat-16',
    priceWithoutVat: '100',
    packSize: '1',
    minBatch: '1',
    stock: '0',
    categoryCode,
  });
  if (offer.status !== 'ok') throw new Error(offer.status);
  const saved = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offer.offerId } });
  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: store.companyId },
  });

  await prisma.$transaction((tx) =>
    applyBalanceChange(tx, {
      locationId: location.id,
      productId: saved.productId,
      quantity: new Decimal(10),
      costPrice: new Decimal(100),
    }),
  );

  return {
    companyId: store.companyId,
    userId: storeUser.id,
    productId: saved.productId,
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.auditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('наценка и переоценка', () => {
  it('common_markup_sets_retail_price', async () => {
    const store = await storeWithCost(1);
    await setMarkup(store.companyId, null, '30');

    expect(await repriceAll(store.companyId, store.userId)).toEqual({ status: 'ok', updated: 1 });

    const price = await prisma.retailPrice.findFirstOrThrow({
      where: { companyId: store.companyId },
    });
    // Правило 1: 100 × 1,3 = 130,00.
    expect(price.price.toFixed(2)).toBe('130.00');
  });

  it('category_rule_wins_over_common', async () => {
    const category = await prisma.category.findFirstOrThrow();
    const store = await storeWithCost(2, category.code);
    await setMarkup(store.companyId, null, '10');
    await setMarkup(store.companyId, category.id, '50');

    await repriceAll(store.companyId, store.userId);

    const price = await prisma.retailPrice.findFirstOrThrow({
      where: { companyId: store.companyId },
    });
    expect(price.price.toFixed(2)).toBe('150.00');
  });

  it('wrong_percent_is_refused_and_reprice_needs_rules', async () => {
    const store = await storeWithCost(3);

    expect(await setMarkup(store.companyId, null, '-5')).toEqual({ status: 'invalid_percent' });
    expect(await repriceAll(store.companyId, store.userId)).toEqual({ status: 'no_rules' });
  });

  it('labels_are_built_only_from_own_prices', async () => {
    const store = await storeWithCost(4);
    const other = await storeWithCost(5);
    await setMarkup(store.companyId, null, '20');
    await repriceAll(store.companyId, store.userId);

    const labels = await getLabels(store.companyId);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.price).toBe('120.00');
    expect(labels[0]!.barcode).toHaveLength(13);

    // Правило 4: чужие цены не отдаются.
    expect(await getLabels(other.companyId)).toEqual([]);
  });
});
