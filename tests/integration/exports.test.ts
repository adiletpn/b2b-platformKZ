import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { recordSwipe } from '@/lib/feed/swipe';
import { checkout } from '@/lib/orders/checkout';
import { changeStatus, confirmOrder } from '@/lib/orders/workflow';
import { createWaybillAndInvoice } from '@/lib/documents/create';
import { acceptDelivery } from '@/lib/acceptance/accept';
import { exportReceiptsToOneC } from '@/lib/exports/one-c';
import { exportEsf } from '@/lib/exports/esf';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

/** Закрытая поставка: есть накладная у магазина и счёт у поставщика. */
async function deliveredOrder(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7779${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7772${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(950 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(951 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 170' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(230000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 10 }),
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
  for (const status of ['PICKING', 'SHIPPED', 'DELIVERED'] as const) {
    await changeStatus(orderId, supplier.companyId, supplierUser.id, status);
  }
  await acceptDelivery(
    orderId,
    store.companyId,
    storeUser.id,
    order.items.map((item) => ({
      orderItemId: item.id,
      quantityAccepted: item.quantityOrdered.toFixed(3),
      quantityDefective: '0.000',
    })),
  );

  const invoice = await prisma.document.findFirstOrThrow({
    where: { orderId, type: 'INVOICE' },
  });

  return {
    storeId: store.companyId,
    supplierId: supplier.companyId,
    invoiceId: invoice.id,
  };
}

const PERIOD = { from: new Date('2020-01-01'), to: new Date('2030-01-01') };

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('выгрузка поступлений в 1С', () => {
  it('receipt_document_has_goods_with_vat', async () => {
    const context = await deliveredOrder(1);

    const xml = await exportReceiptsToOneC(context.storeId, PERIOD.from, PERIOD.to);

    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('КоммерческаяИнформация');
    expect(xml).toContain('<ХозОперация>Поступление товаров</ХозОперация>');
    expect(xml).toContain('<Валюта>KZT</Валюта>');
    // Правило 1: суммы с двумя знаками, ставка НДС из справочника.
    expect(xml).toMatch(/<Сумма>\d+\.\d{2}<\/Сумма>/);
    expect(xml).toContain('<Ставка>16.00</Ставка>');
  });

  it('export_of_another_company_is_empty', async () => {
    const context = await deliveredOrder(2);

    // Правило 4: поставщик не выгружает поступления магазина.
    const xml = await exportReceiptsToOneC(context.supplierId, PERIOD.from, PERIOD.to);
    expect(xml).not.toContain('<Документ>');
  });

  it('period_outside_documents_gives_empty_export', async () => {
    const context = await deliveredOrder(3);

    const xml = await exportReceiptsToOneC(
      context.storeId,
      new Date('2019-01-01'),
      new Date('2019-12-31'),
    );
    expect(xml).not.toContain('<Документ>');
  });
});

describe('ЭСФ в XML', () => {
  it('invoice_xml_has_parties_items_and_totals', async () => {
    const context = await deliveredOrder(4);

    const result = await exportEsf(context.invoiceId, context.supplierId);

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.xml).toContain('<invoice xmlns="urn:kz:esf:invoice">');
    expect(result.xml).toContain('<sellers><seller>');
    expect(result.xml).toContain('<customers><customer>');
    expect(result.xml).toMatch(/<tin>\d{12}<\/tin>/);
    expect(result.xml).toMatch(/<vatRate>16\.00<\/vatRate>/);
    expect(result.xml).toMatch(/<totalWithTax>\d+\.\d{2}<\/totalWithTax>/);
  });

  it('esf_is_issued_only_by_the_seller', async () => {
    const context = await deliveredOrder(5);

    // Правило 4: покупатель счёт не выписывал — выгрузки нет.
    expect(await exportEsf(context.invoiceId, context.storeId)).toEqual({ status: 'not_found' });
    expect(await exportEsf('no-such-document', context.supplierId)).toEqual({
      status: 'not_found',
    });
  });
});
