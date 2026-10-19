import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, gtin13, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { importCatalog } from '@/lib/catalog/import';
import { registerCompany } from '@/lib/registration/register-company';

const prisma = createTestPrisma();

async function createSupplier(phone: string, bin: string) {
  const user = await prisma.user.create({ data: { phone } });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const result = await registerCompany({
    userId: user.id,
    bin,
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(`регистрация не прошла: ${result.status}`);
  return result.companyId;
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('импорт каталога', () => {
  it('supplier_imports_200_products_from_excel', async () => {
    const supplierId = await createSupplier('+77020000001', '120340001230');
    const rows = Array.from({ length: 200 }, (_, index) => validRow(index + 1));
    const file = await buildCatalogXlsx(rows);

    const result = await importCatalog(supplierId, toArrayBuffer(file));

    expect(result.errors).toEqual([]);
    expect(result.created).toBe(200);
    expect(result.updated).toBe(0);
    expect(await prisma.supplierOffer.count({ where: { supplierId } })).toBe(200);
    expect(await prisma.product.count()).toBe(200);
  }, 120_000);

  it('import_computes_price_with_vat_from_reference_rate', async () => {
    const supplierId = await createSupplier('+77020000002', '120340001230');
    const file = await buildCatalogXlsx([validRow(1, { priceWithoutVat: '1000.00' })]);

    await importCatalog(supplierId, toArrayBuffer(file));

    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId } });
    // Ставка 16% берётся из справочника БД, не из кода.
    expect(offer.priceWithoutVat.toFixed(2)).toBe('1000.00');
    expect(offer.priceWithVat.toFixed(2)).toBe('1160.00');
  });

  it('import_reports_row_errors_and_skips_only_bad_rows', async () => {
    const supplierId = await createSupplier('+77020000003', '120340001230');
    const file = await buildCatalogXlsx([
      validRow(1),
      validRow(2, { barcode: '1234567890123' }),
      validRow(3, { unitCode: 'ящик' }),
      validRow(4),
    ]);

    const result = await importCatalog(supplierId, toArrayBuffer(file));

    expect(result.created).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({ row: 3, code: 'invalid_barcode' });
    expect(result.errors[1]).toMatchObject({ row: 4, code: 'unknown_unit' });
    expect(await prisma.supplierOffer.count({ where: { supplierId } })).toBe(2);
  });

  it('repeated_import_updates_offers_without_duplicates', async () => {
    const supplierId = await createSupplier('+77020000004', '120340001230');
    const first = await buildCatalogXlsx([validRow(1, { priceWithoutVat: '100.00' })]);
    const second = await buildCatalogXlsx([validRow(1, { priceWithoutVat: '150.00' })]);

    await importCatalog(supplierId, toArrayBuffer(first));
    const result = await importCatalog(supplierId, toArrayBuffer(second));

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(await prisma.supplierOffer.count({ where: { supplierId } })).toBe(1);
    const offer = await prisma.supplierOffer.findFirstOrThrow({ where: { supplierId } });
    expect(offer.priceWithoutVat.toFixed(2)).toBe('150.00');
  });

  it('same_barcode_from_two_suppliers_is_one_product', async () => {
    const first = await createSupplier('+77020000005', '120340001230');
    const second = await createSupplier('+77020000006', '150640004569');
    const barcode = gtin13('487020400999');

    await importCatalog(first, toArrayBuffer(await buildCatalogXlsx([validRow(1, { barcode })])));
    await importCatalog(second, toArrayBuffer(await buildCatalogXlsx([validRow(2, { barcode })])));

    // Раздел 3.2 ТЗ: один штрихкод — один товар в общем справочнике.
    expect(await prisma.product.count()).toBe(1);
    expect(await prisma.supplierOffer.count()).toBe(2);
  });

  it('import_does_not_touch_offers_of_another_supplier', async () => {
    const mine = await createSupplier('+77020000007', '120340001230');
    const other = await createSupplier('+77020000008', '150640004569');

    await importCatalog(other, toArrayBuffer(await buildCatalogXlsx([validRow(10), validRow(11)])));
    await importCatalog(mine, toArrayBuffer(await buildCatalogXlsx([validRow(1)])));

    expect(await prisma.supplierOffer.count({ where: { supplierId: other } })).toBe(2);
    expect(await prisma.supplierOffer.count({ where: { supplierId: mine } })).toBe(1);
  });
});
