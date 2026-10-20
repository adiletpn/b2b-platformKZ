import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { recordSwipe } from '@/lib/feed/swipe';
import { checkout } from '@/lib/orders/checkout';
import { confirmOrder } from '@/lib/orders/workflow';
import { createWaybillAndInvoice } from '@/lib/documents/create';
import { searchDocuments } from '@/lib/archive/search';
import { exportDocuments } from '@/lib/archive/export';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function orderWithDocuments(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7790${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7791${String(index).padStart(7, '0')}` },
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
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 60' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(170000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 5 }),
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

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: created.orders[0]!.id },
    include: { items: true },
  });
  await confirmOrder(
    order.id,
    supplier.companyId,
    supplierUser.id,
    order.items.map((item) => ({
      orderItemId: item.id,
      quantityConfirmed: item.quantityOrdered.toFixed(3),
    })),
  );
  await createWaybillAndInvoice(order.id, supplier.companyId);

  return { orderId: order.id, supplierId: supplier.companyId, storeId: store.companyId };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('архив документов', () => {
  it('archive_shows_documents_of_both_sides', async () => {
    const context = await orderWithDocuments(1);

    const forSupplier = await searchDocuments(context.supplierId);
    const forStore = await searchDocuments(context.storeId);

    expect(forSupplier).toHaveLength(2);
    expect(forStore).toHaveLength(2);
    // Для выставившего документ он исходящий, для получателя — входящий.
    expect(forSupplier.every((row) => row.outgoing)).toBe(true);
    expect(forStore.every((row) => row.outgoing)).toBe(false);
  });

  it('archive_filters_by_type_and_number', async () => {
    const context = await orderWithDocuments(2);

    const waybills = await searchDocuments(context.supplierId, { type: 'WAYBILL' });
    expect(waybills).toHaveLength(1);
    expect(waybills[0]!.type).toBe('WAYBILL');

    const byNumber = await searchDocuments(context.supplierId, {
      search: waybills[0]!.number,
    });
    expect(byNumber).toHaveLength(1);
  });

  it('archive_search_and_counterparty_filter_do_not_leak_other_companies', async () => {
    const own = await orderWithDocuments(5);
    const other = await orderWithDocuments(6);

    // Номера документов у всех компаний одного вида: поиск по общему префиксу
    // и фильтр по чужому контрагенту не должны отдавать чужие документы (правило 4).
    const [sample] = await searchDocuments(own.storeId);
    const prefix = sample!.number.slice(0, 2);
    const bySearch = await searchDocuments(own.storeId, { search: prefix });
    expect(bySearch.length).toBeGreaterThan(0);
    expect(bySearch.every((row) => row.counterpartyName !== '')).toBe(true);
    const ownIds = new Set((await searchDocuments(own.storeId)).map((row) => row.id));
    expect(bySearch.every((row) => ownIds.has(row.id))).toBe(true);

    expect(await searchDocuments(own.storeId, { counterpartyId: other.supplierId })).toEqual([]);
  });

  it('archive_filters_by_amount_and_period', async () => {
    const context = await orderWithDocuments(3);

    const huge = await searchDocuments(context.supplierId, { minTotal: '99999999' });
    expect(huge).toHaveLength(0);

    const future = new Date();
    future.setFullYear(future.getFullYear() + 1);
    const later = await searchDocuments(context.supplierId, { from: future });
    expect(later).toHaveLength(0);
  });

  it('archive_of_another_company_is_not_visible', async () => {
    const first = await orderWithDocuments(4);
    const second = await orderWithDocuments(5);

    const mine = await searchDocuments(first.supplierId);
    const foreign = await searchDocuments(second.supplierId);

    // Номера заявок у компаний свои и могут совпадать, поэтому сверяем документы.
    const foreignIds = new Set(foreign.map((row) => row.id));
    expect(mine).toHaveLength(2);
    expect(mine.some((row) => foreignIds.has(row.id))).toBe(false);
  });
});

describe('выгрузка в Excel', () => {
  it('documents_register_is_exported_to_excel', async () => {
    const context = await orderWithDocuments(6);
    const rows = await searchDocuments(context.supplierId);

    const file = await exportDocuments(rows, {
      sheet: 'Документы',
      number: 'Номер',
      type: 'Тип',
      date: 'Дата',
      counterparty: 'Контрагент',
      order: 'Заявка',
      total: 'Сумма с НДС',
      WAYBILL: 'Накладная З-2',
      INVOICE: 'Счёт на оплату',
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(toArrayBuffer(file));
    const sheet = workbook.worksheets[0]!;

    expect(sheet.name).toBe('Документы');
    // Заголовок плюс две строки документов.
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(1).getCell(1).value).toBe('Номер');
    expect(String(sheet.getRow(2).getCell(2).value)).toContain('Накладная');
  });
});
