import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { parseCatalogFile, type ParseReference } from '@/lib/catalog/parse';
import { priceWithVat } from '@/lib/catalog/import';
import { isValidGtin } from '@/lib/catalog/gtin';
import { buildCatalogXlsx, gtin13, toArrayBuffer, validRow } from '../helpers/catalog-fixture';

const reference: ParseReference = {
  unitCodes: new Set(['pcs', 'kg', 'l', 'pack']),
  categoryCodes: new Set(['grocery', 'dairy']),
  vatCodes: new Set(['vat-16', 'vat-0']),
};

async function parse(rows: Parameters<typeof buildCatalogXlsx>[0]) {
  return parseCatalogFile(toArrayBuffer(await buildCatalogXlsx(rows)), reference);
}

describe('разбор файла каталога', () => {
  it('catalog_parses_valid_rows', async () => {
    const { rows, errors } = await parse([validRow(1), validRow(2)]);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.priceWithoutVat.toFixed(2)).toBe('451.00');
    expect(rows[0]!.packSize.toFixed(3)).toBe('12.000');
  });

  it('catalog_error_points_to_excel_row_number', async () => {
    // Строка 1 — заголовок, значит первая строка данных это строка 2.
    const { errors } = await parse([validRow(1), validRow(2, { nameRu: '' }), validRow(3)]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 3, column: 'nameRu', code: 'required' });
  });

  it('catalog_rejects_barcode_with_wrong_checksum', async () => {
    const { errors, rows } = await parse([validRow(1, { barcode: '4870204000001' })]);
    expect(errors[0]).toMatchObject({ row: 2, column: 'barcode', code: 'invalid_barcode' });
    expect(rows).toHaveLength(0);
  });

  it('catalog_reports_duplicate_barcode_with_first_row_number', async () => {
    const barcode = gtin13('487020400777');
    const { errors } = await parse([validRow(1, { barcode }), validRow(2, { barcode })]);
    expect(errors[0]).toMatchObject({
      row: 3,
      column: 'barcode',
      code: 'duplicate_barcode',
      hint: '2',
    });
  });

  it('catalog_rejects_unknown_reference_codes', async () => {
    const { errors } = await parse([
      validRow(1, { unitCode: 'ящик', categoryCode: 'нет-такой', vatCode: 'vat-99' }),
    ]);
    expect(errors.map((error) => error.code)).toEqual([
      'unknown_unit',
      'unknown_category',
      'unknown_vat',
    ]);
    expect(errors[0]!.hint).toBe('ящик');
  });

  it('catalog_rejects_money_with_more_than_two_decimals', async () => {
    const { errors } = await parse([validRow(1, { priceWithoutVat: '450.555' })]);
    expect(errors[0]).toMatchObject({
      column: 'priceWithoutVat',
      code: 'too_many_decimals',
      hint: '2',
    });
  });

  it('catalog_allows_three_decimals_for_quantities', async () => {
    const { rows, errors } = await parse([validRow(1, { stock: '12.345', minBatch: '0.500' })]);
    expect(errors).toEqual([]);
    expect(rows[0]!.stock.toFixed(3)).toBe('12.345');
    expect(rows[0]!.minBatch.toFixed(3)).toBe('0.500');
  });

  it('catalog_rejects_negative_and_non_numeric_values', async () => {
    const { errors } = await parse([validRow(1, { stock: '-5', priceWithoutVat: 'дорого' })]);
    expect(errors.map((error) => error.code).sort()).toEqual(['invalid_number', 'negative']);
  });

  it('catalog_rejects_wrong_date_format', async () => {
    const { errors } = await parse([validRow(1, { expiresAt: '2026-12-31' })]);
    expect(errors[0]).toMatchObject({ column: 'expiresAt', code: 'invalid_date' });
  });

  it('catalog_reads_boolean_flags_in_both_languages', async () => {
    const { rows } = await parse([
      validRow(1, { isMarked: 'да', isExcise: 'иә', requiresSnt: 'жоқ' }),
    ]);
    expect(rows[0]!.isMarked).toBe(true);
    expect(rows[0]!.isExcise).toBe(true);
    expect(rows[0]!.requiresSnt).toBe(false);
  });

  it('catalog_collects_all_errors_not_only_the_first', async () => {
    const { errors } = await parse([
      validRow(1, { nameKk: '' }),
      validRow(2, { unitCode: '' }),
      validRow(3, { vatCode: '' }),
    ]);
    expect(errors.map((error) => error.row)).toEqual([2, 3, 4]);
  });

  it('catalog_accepts_photo_link_and_rejects_garbage', async () => {
    const { rows } = await parse([validRow(1, { photoUrl: 'https://example.kz/milk.jpg' })]);
    expect(rows[0]!.photoUrl).toBe('https://example.kz/milk.jpg');

    const local = await parse([validRow(2, { photoUrl: '/products/dairy.svg' })]);
    expect(local.rows[0]!.photoUrl).toBe('/products/dairy.svg');

    const { errors } = await parse([validRow(3, { photoUrl: 'картинка.jpg' })]);
    expect(errors[0]).toMatchObject({ column: 'photoUrl', code: 'invalid_photo_url' });
  });

  it('catalog_reports_empty_file', async () => {
    const { errors } = await parse([]);
    expect(errors[0]).toMatchObject({ code: 'empty_file' });
  });
});

describe('цена с НДС', () => {
  it('price_with_vat_uses_decimal_and_rounds_to_two_digits', () => {
    expect(priceWithVat(new Decimal('450.00'), new Decimal('16')).toFixed(2)).toBe('522.00');
    expect(priceWithVat(new Decimal('333.33'), new Decimal('16')).toFixed(2)).toBe('386.66');
    expect(priceWithVat(new Decimal('100.01'), new Decimal('0')).toFixed(2)).toBe('100.01');
  });
});

describe('штрихкод', () => {
  it('gtin_accepts_known_lengths_and_checks_digit', () => {
    expect(isValidGtin(gtin13('487020400001'))).toBe(true);
    expect(isValidGtin('4870204000011')).toBe(false);
    expect(isValidGtin('123')).toBe(false);
    expect(isValidGtin('abcdefghijklm')).toBe(false);
  });
});
