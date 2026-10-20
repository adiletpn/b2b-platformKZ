import Decimal from 'decimal.js';
import type { PrismaClient } from '@/generated/prisma/client';
import { registerCompany } from '@/lib/registration/register-company';
import { createOfferManually } from '@/lib/catalog/manual';
import { applyBalanceChange } from '@/lib/stock/balance';
import { receiveBatch } from '@/lib/stock/batches';
import { setMarkup, repriceAll } from '@/lib/stock/pricing';
import { testPoolBin } from '@/mocks/bin-registry';

/** EAN-13 с верной контрольной цифрой. */
export function ean13(base: string) {
  const digits = base.padStart(12, '0').slice(0, 12).split('').map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return `${digits.join('')}${(10 - (sum % 10)) % 10}`;
}

/** Магазин с товаром на остатке 10 по себестоимости 100 и розничной ценой 130. */
export async function shopReadyToSell(prisma: PrismaClient, index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7781${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7782${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(970 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(971 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 180' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  const offer = await createOfferManually(supplier.companyId, {
    barcode: ean13(`48700050000${index}`),
    nameRu: 'Товар кассы',
    nameKk: 'Касса тауары',
    unitCode: 'pcs',
    vatCode: 'vat-16',
    priceWithoutVat: '100',
    packSize: '1',
    minBatch: '1',
    stock: '0',
  });
  if (offer.status !== 'ok') throw new Error(offer.status);
  const saved = await prisma.supplierOffer.findUniqueOrThrow({ where: { id: offer.offerId } });
  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: store.companyId },
  });

  // Остаток 10 по себестоимости 100 и розничная цена 130.
  await prisma.$transaction(async (tx) => {
    await receiveBatch(tx, {
      locationId: location.id,
      productId: saved.productId,
      quantity: new Decimal(10),
      costPrice: new Decimal(100),
      expiresAt: null,
    });
    await applyBalanceChange(tx, {
      locationId: location.id,
      productId: saved.productId,
      quantity: new Decimal(10),
      costPrice: new Decimal(100),
    });
  });
  await setMarkup(store.companyId, null, '30');
  await repriceAll(store.companyId, storeUser.id);

  return {
    companyId: store.companyId,
    userId: storeUser.id,
    locationId: location.id,
    productId: saved.productId,
  };
}
