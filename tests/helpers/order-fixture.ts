import type { PrismaClient } from '@/generated/prisma/client';
import { buildCatalogXlsx, toArrayBuffer, validRow } from './catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { recordSwipe } from '@/lib/feed/swipe';
import { checkout } from '@/lib/orders/checkout';
import { changeStatus, confirmOrder } from '@/lib/orders/workflow';
import { createWaybillAndInvoice } from '@/lib/documents/create';
import type { OrderStatus } from '@/generated/prisma/enums';
import { testPoolBin } from '@/mocks/bin-registry';

/**
 * Заявка «магазин — поставщик» с накладной и счётом для интеграционных тестов этапа 2.
 * `phones` — две свободные четвёрки цифр после +7, `binBase` — начало пула БИН.
 */
export async function orderFixture(
  prisma: PrismaClient,
  options: {
    index: number;
    phones: [string, string];
    binBase: number;
    productBase: number;
    upTo?: OrderStatus;
    creditLimit?: string;
  },
) {
  const { index } = options;
  const supplierUser = await prisma.user.create({
    data: { phone: `+7${options.phones[0]}${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7${options.phones[1]}${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(options.binBase + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(options.binBase + 1 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 99' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(options.productBase + index, {
          priceWithoutVat: '100.00',
          packSize: 1,
          minBatch: 5,
        }),
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

  const context = {
    orderId,
    offerId: offer.id,
    locationId: location.id,
    cityId: taraz.id,
    supplierId: supplier.companyId,
    supplierUserId: supplierUser.id,
    storeId: store.companyId,
    storeUserId: storeUser.id,
  };
  if (options.upTo === 'SENT') return context;

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
  await createWaybillAndInvoice(orderId, supplier.companyId);
  for (const status of ['PICKING', 'SHIPPED'] as const) {
    if (options.upTo === 'ACCEPTED') break;
    await changeStatus(orderId, supplier.companyId, supplierUser.id, status);
    if (options.upTo === status) break;
  }
  return context;
}
