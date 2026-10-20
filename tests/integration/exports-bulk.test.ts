import { inflateRawSync } from 'node:zlib';
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
import { recordPayment } from '@/lib/payments/record';
import { openShift, closeShift } from '@/lib/pos/shift';
import { sell } from '@/lib/pos/sale';
import { correctDocument } from '@/lib/documents/versions';
import { documentHtml } from '@/lib/documents/templates';
import { maskBin, verificationUrl, verifyDocument } from '@/lib/documents/verification';
import { buildDocumentsBundle, type BundleInput } from '@/lib/exports/bundle';
import { catalogCsv, stockCsv, toCsv } from '@/lib/exports/csv';
import {
  exportCounterpartiesToOneC,
  exportNomenclatureToOneC,
  exportPaymentsToOneC,
  exportSalesToOneC,
} from '@/lib/exports/one-c';
import { qrMatrix } from '@/lib/qr/qr';
import type { DocumentPayload } from '@/lib/documents/payload';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

/** Полный цикл: заявка принята магазином и оплачена, товар продан на кассе. */
async function paidOrder(index: number, productName?: string) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7787${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7788${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(600 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(601 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 88' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');
  await prisma.company.update({
    where: { id: supplier.companyId },
    data: { iik: 'KZ07HSBK123456789012', bik: 'HSBKKZKX', bankName: 'Тестовый банк' },
  });

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(260000 + index, {
          priceWithoutVat: '100.00',
          packSize: 1,
          minBatch: 4,
          ...(productName ? { nameRu: productName } : {}),
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
  await changeStatus(orderId, store.companyId, storeUser.id, 'AWAITING_PAYMENT');
  const paid = await recordPayment({
    orderId,
    storeId: store.companyId,
    userId: storeUser.id,
    amount: '464.00',
    method: 'ON_DELIVERY',
    paidAt: new Date().toISOString().slice(0, 10),
    reference: `ПП-${index}`,
  });
  if (paid.status !== 'ok') throw new Error(paid.status);

  return {
    orderId,
    productId: offer.productId,
    locationId: location.id,
    supplierId: supplier.companyId,
    supplierUserId: supplierUser.id,
    storeId: store.companyId,
    storeUserId: storeUser.id,
  };
}

/** Читает ZIP: имена и содержимое файлов по центральному каталогу. */
function unzip(zip: Buffer): Map<string, Buffer> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(end + 10);
  let pointer = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let index = 0; index < count; index += 1) {
    const size = zip.readUInt32LE(pointer + 20);
    const nameLength = zip.readUInt16LE(pointer + 28);
    const offset = zip.readUInt32LE(pointer + 42);
    const name = zip.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');
    const dataStart = offset + 30 + zip.readUInt16LE(offset + 26);
    files.set(name, inflateRawSync(zip.subarray(dataStart, dataStart + size)));
    pointer += 46 + nameLength;
  }
  return files;
}

const LABELS: BundleInput['labels'] = {
  types: {
    WAYBILL: 'Накладная З-2',
    INVOICE: 'Счёт на оплату',
    DISCREPANCY_ACT: 'Акт расхождений',
    RETURN_WAYBILL: 'Возвратная накладная',
    SETTLEMENT_ACT: 'Акт сверки',
  },
  registry: { sheet: 'Реестр документов' },
  esf: 'ЭСФ',
};

function period() {
  const now = Date.now();
  return { from: new Date(now - 86_400_000), to: new Date(now + 86_400_000) };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('массовая выгрузка документов архивом', () => {
  it('bundle_has_pdf_of_each_document_registry_and_esf', async () => {
    const context = await paidOrder(1);
    await paidOrder(2);

    const result = await buildDocumentsBundle({
      companyId: context.supplierId,
      ...period(),
      locale: 'ru',
      baseUrl: 'https://b2b.test',
      labels: LABELS,
    });
    if (result.status !== 'ok') throw new Error(result.status);

    const files = unzip(result.zip);
    const names = [...files.keys()].sort();
    // Правило 4: в архиве только документы своей заявки — накладная, счёт и ЭСФ к счёту.
    expect(result.count).toBe(2);
    expect(names).toHaveLength(4);
    expect(names.some((name) => name.startsWith('Накладная З-2/') && name.endsWith('.pdf'))).toBe(
      true,
    );
    expect(names.some((name) => name.startsWith('ЭСФ/') && name.endsWith('.xml'))).toBe(true);
    expect(names).toContain('Реестр документов.xlsx');
    for (const name of names.filter((item) => item.endsWith('.pdf'))) {
      expect(files.get(name)!.subarray(0, 5).toString()).toBe('%PDF-');
    }
  });

  it('bundle_refuses_empty_and_too_long_period', async () => {
    const context = await paidOrder(3);
    const base = {
      companyId: context.storeId,
      locale: 'ru' as const,
      baseUrl: 'x',
      labels: LABELS,
    };

    expect(
      await buildDocumentsBundle({
        ...base,
        from: new Date('2020-01-01'),
        to: new Date('2020-01-31'),
      }),
    ).toEqual({ status: 'empty' });
    expect(
      await buildDocumentsBundle({ ...base, from: new Date('2024-01-01'), to: new Date() }),
    ).toEqual({ status: 'invalid_period' });
  });
});

describe('CSV каталога и остатков', () => {
  it('catalog_csv_has_only_own_offers_and_neutralizes_formulas', async () => {
    const context = await paidOrder(4, '=HYPERLINK("http://evil")');
    await paidOrder(5);

    const csv = await catalogCsv(context.supplierId);
    const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');

    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toContain('barcode,sku,name_ru');
    expect(lines).toHaveLength(2);
    // Название-формула не исполнится в Excel: впереди апостроф, кавычки удвоены.
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(lines[1]).toContain('100.00,16.00,116.00');
  });

  it('stock_csv_shows_cost_only_with_purchase_price_right', async () => {
    const context = await paidOrder(6);

    const withCost = await stockCsv(context.storeId, { allowedLocationIds: [], withCost: true });
    const withoutCost = await stockCsv(context.storeId, {
      allowedLocationIds: [],
      withCost: false,
    });
    expect(withCost).toContain('average_cost');
    expect(withCost).toContain('4.000,,100.00');
    expect(withoutCost).not.toContain('average_cost');
    expect(withoutCost).not.toContain('100.00');

    // Сотрудник другой точки не видит остатков этой.
    const foreign = await stockCsv(context.storeId, {
      allowedLocationIds: ['other-location'],
      withCost: true,
    });
    expect(foreign.trimEnd().split('\r\n')).toHaveLength(1);
    expect(
      await stockCsv(context.supplierId, { allowedLocationIds: [], withCost: true }),
    ).not.toContain('Тестовый товар');
  });

  it('csv_quotes_commas_and_line_breaks', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'строка\nвторая']])).toBe(
      '﻿a,b\r\n"x,y","строка\nвторая"\r\n',
    );
  });
});

describe('выгрузки в 1С', () => {
  it('nomenclature_and_counterparties_are_own_only', async () => {
    const context = await paidOrder(7);
    const other = await paidOrder(8);

    const nomenclature = await exportNomenclatureToOneC(context.supplierId);
    expect(nomenclature).toContain('<Штрихкод>');
    expect(nomenclature).toContain('Тестовый товар 260007');
    expect(nomenclature).not.toContain('Тестовый товар 260008');
    expect(nomenclature).toContain('<Ставка>16.00</Ставка>');

    // Магазин видит в номенклатуре то, что лежит у него на остатках.
    expect(await exportNomenclatureToOneC(context.storeId)).toContain('Тестовый товар 260007');

    const counterparties = await exportCounterpartiesToOneC(context.storeId);
    expect(counterparties).toContain('<НомерСчета>KZ07HSBK123456789012</НомерСчета>');
    expect(counterparties).toContain('<Роль>Поставщик</Роль>');
    const otherSupplier = await prisma.company.findUniqueOrThrow({
      where: { id: other.supplierId },
    });
    expect(counterparties).not.toContain(otherSupplier.bin);
  });

  it('sales_have_waybills_of_seller_and_closed_pos_shifts', async () => {
    const context = await paidOrder(9);
    const { from, to } = period();

    const supplierSales = await exportSalesToOneC(context.supplierId, from, to);
    expect(supplierSales).toContain('<ХозОперация>Отпуск товара</ХозОперация>');
    expect(supplierSales).toContain('<Роль>Покупатель</Роль>');
    // Магазин накладных не выписывал: в его реализациях их нет.
    expect(await exportSalesToOneC(context.storeId, from, to)).not.toContain('Отпуск товара');

    await openShift(context.storeId, context.storeUserId, context.locationId);
    const sale = await sell(context.storeId, context.storeUserId, context.locationId, {
      clientId: 'export-1',
      paymentType: 'CASH',
      lines: [{ productId: context.productId, quantity: '2', price: '150.00' }],
    });
    if (sale.status !== 'ok') throw new Error(sale.status);
    const shift = await prisma.posShift.findFirstOrThrow({ where: { companyId: context.storeId } });
    await closeShift(context.storeId, context.storeUserId, shift.id);

    const retail = await exportSalesToOneC(context.storeId, from, to);
    expect(retail).toContain('<ХозОперация>Отчет о розничных продажах</ХозОперация>');
    expect(retail).toContain('<Количество>2.000</Количество>');
    expect(retail).toContain('<Сумма>300.00</Сумма>');
  });

  it('payments_are_seen_by_both_sides_with_own_role', async () => {
    const context = await paidOrder(10);
    const other = await paidOrder(11);
    const today = new Date(new Date().toISOString().slice(0, 10));

    const forStore = await exportPaymentsToOneC(context.storeId, today, today);
    const forSupplier = await exportPaymentsToOneC(context.supplierId, today, today);
    expect(forStore).toContain('<Номер>ПП-10</Номер>');
    expect(forStore).toContain('<Сумма>464.00</Сумма>');
    expect(forStore).toContain('<Роль>Покупатель</Роль><Валюта>');
    expect(forSupplier).toContain('<Роль>Продавец</Роль><Валюта>');
    // Правило 4: чужая оплата не попадает.
    expect(forStore).not.toContain('ПП-11');
    expect(await exportPaymentsToOneC(other.storeId, today, today)).not.toContain('ПП-10');
  });
});

describe('QR проверки документа', () => {
  it('printed_form_has_qr_with_verification_link', async () => {
    const context = await paidOrder(12);
    const invoice = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'INVOICE' },
    });
    const url = verificationUrl('https://b2b.test/', 'kk', invoice.verificationCode, 1);
    expect(url).toBe(`https://b2b.test/kk/verify/${invoice.verificationCode}?v=1`);

    const html = documentHtml('INVOICE', invoice.payload as unknown as DocumentPayload, 'kk', {
      verifyUrl: url,
    });
    expect(html).toContain('Құжатты тексеру');
    expect(html).toContain(`viewBox="0 0 ${qrMatrix(url)!.length + 8}`);
    expect(
      documentHtml('INVOICE', invoice.payload as unknown as DocumentPayload, 'ru'),
    ).not.toContain('<svg');
  });

  it('verification_page_data_masks_bin_and_marks_old_paper', async () => {
    const context = await paidOrder(13);
    const invoice = await prisma.document.findFirstOrThrow({
      where: { orderId: context.orderId, type: 'INVOICE' },
      include: { issuer: true },
    });

    const view = await verifyDocument(invoice.verificationCode, 1);
    expect(view).toMatchObject({ number: invoice.number, totalWithVat: '464.00', outdated: false });
    expect(view!.issuer.bin).toBe(maskBin(invoice.issuer.bin));
    expect(view!.issuer.bin).not.toBe(invoice.issuer.bin);

    await correctDocument({
      documentId: invoice.id,
      companyId: context.supplierId,
      userId: context.supplierUserId,
      reason: 'Новый адрес',
    });
    expect(await verifyDocument(invoice.verificationCode, 1)).toMatchObject({
      outdated: true,
      currentVersion: 2,
    });

    expect(await verifyDocument('00000000-0000-0000-0000-000000000000')).toBeNull();
    expect(await verifyDocument("' or 1=1 --")).toBeNull();
  });
});
