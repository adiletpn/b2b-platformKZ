import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { CATALOG_COLUMNS, FIRST_DATA_ROW, type CatalogColumnKey } from './columns';
import { isValidGtin } from './gtin';

export type RowError = {
  /** Номер строки в файле Excel, как его видит поставщик. */
  row: number;
  column: CatalogColumnKey | 'file';
  code:
    | 'required'
    | 'invalid_barcode'
    | 'duplicate_barcode'
    | 'unknown_unit'
    | 'unknown_category'
    | 'unknown_vat'
    | 'invalid_number'
    | 'too_many_decimals'
    | 'negative'
    | 'invalid_date'
    | 'invalid_boolean'
    | 'invalid_photo_url'
    | 'empty_file'
    | 'no_sheet';
  /** Подставляется в текст ошибки: дублирующая строка, неизвестный код и т. п. */
  hint?: string;
};

export type ParsedRow = {
  row: number;
  barcode: string;
  nameRu: string;
  nameKk: string;
  sku: string | null;
  brand: string | null;
  categoryCode: string | null;
  manufacturer: string | null;
  country: string | null;
  unitCode: string;
  packSize: Decimal;
  minBatch: Decimal;
  priceWithoutVat: Decimal;
  vatCode: string;
  stock: Decimal;
  expiresAt: Date | null;
  isMarked: boolean;
  isExcise: boolean;
  requiresSnt: boolean;
  isLicensed: boolean;
  tnvedCode: string | null;
  photoUrl: string | null;
};

export type ParseReference = {
  unitCodes: Set<string>;
  categoryCodes: Set<string>;
  vatCodes: Set<string>;
};

export type ParseResult = { rows: ParsedRow[]; errors: RowError[] };

const TRUE_WORDS = new Set(['да', 'иә', 'yes', 'true', '1', '+']);
const FALSE_WORDS = new Set(['нет', 'жоқ', 'no', 'false', '0', '-', '']);

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const day = String(value.getUTCDate()).padStart(2, '0');
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${value.getUTCFullYear()}`;
  }
  if (typeof value === 'object' && 'result' in value) return String(value.result ?? '');
  if (typeof value === 'object' && 'text' in value) return String(value.text ?? '');
  return String(value).trim();
}

function parseDecimal(
  text: string,
  maxDecimals: number,
  row: number,
  column: CatalogColumnKey,
  errors: RowError[],
  fallback: string,
): Decimal {
  const raw = text.replace(/\s/g, '').replace(',', '.');
  if (raw === '') return new Decimal(fallback);

  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    errors.push({ row, column, code: 'invalid_number' });
    return new Decimal(fallback);
  }
  const value = new Decimal(raw);
  if (value.isNegative()) {
    errors.push({ row, column, code: 'negative' });
    return new Decimal(fallback);
  }
  if (value.decimalPlaces() > maxDecimals) {
    errors.push({ row, column, code: 'too_many_decimals', hint: String(maxDecimals) });
    return value.toDecimalPlaces(maxDecimals);
  }
  return value;
}

function parseBoolean(
  text: string,
  row: number,
  column: CatalogColumnKey,
  errors: RowError[],
): boolean {
  const normalized = text.trim().toLowerCase();
  if (TRUE_WORDS.has(normalized)) return true;
  if (FALSE_WORDS.has(normalized)) return false;
  errors.push({ row, column, code: 'invalid_boolean' });
  return false;
}

/** Фото хранится ссылкой: загрузка файлов требует хранилища S3 и в демо не делается. */
function parsePhotoUrl(text: string, row: number, errors: RowError[]): string | null {
  const value = text.trim();
  if (value === '') return null;

  const isHttpUrl = /^https?:\/\/\S+$/i.test(value) || value.startsWith('/');
  if (!isHttpUrl) {
    errors.push({ row, column: 'photoUrl', code: 'invalid_photo_url' });
    return null;
  }
  return value;
}

function parseDate(text: string, row: number, errors: RowError[]): Date | null {
  if (text === '') return null;
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
  if (!match) {
    errors.push({ row, column: 'expiresAt', code: 'invalid_date' });
    return null;
  }
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    errors.push({ row, column: 'expiresAt', code: 'invalid_date' });
    return null;
  }
  return date;
}

/** Разбирает файл каталога. Ошибки собираются по всем строкам, а не до первой. */
export async function parseCatalogFile(
  file: ArrayBuffer,
  reference: ParseReference,
): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file);

  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: [{ row: 0, column: 'file', code: 'no_sheet' }] };

  const columnIndex = new Map<CatalogColumnKey, number>(
    CATALOG_COLUMNS.map((column, index) => [column.key, index + 1]),
  );
  const text = (row: ExcelJS.Row, key: CatalogColumnKey) =>
    cellText(row.getCell(columnIndex.get(key)!));

  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const seenBarcodes = new Map<string, number>();

  for (let rowNumber = FIRST_DATA_ROW; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = CATALOG_COLUMNS.map((column) => text(row, column.key));
    if (values.every((value) => value === '')) continue;

    const errorsBefore = errors.length;

    for (const column of CATALOG_COLUMNS) {
      if (column.required && text(row, column.key) === '') {
        errors.push({ row: rowNumber, column: column.key, code: 'required' });
      }
    }

    const barcode = text(row, 'barcode');
    if (barcode !== '' && !isValidGtin(barcode)) {
      errors.push({ row: rowNumber, column: 'barcode', code: 'invalid_barcode' });
    } else if (barcode !== '') {
      const previous = seenBarcodes.get(barcode);
      if (previous) {
        errors.push({
          row: rowNumber,
          column: 'barcode',
          code: 'duplicate_barcode',
          hint: String(previous),
        });
      } else {
        seenBarcodes.set(barcode, rowNumber);
      }
    }

    const unitCode = text(row, 'unitCode');
    if (unitCode !== '' && !reference.unitCodes.has(unitCode)) {
      errors.push({ row: rowNumber, column: 'unitCode', code: 'unknown_unit', hint: unitCode });
    }

    const categoryCode = text(row, 'categoryCode');
    if (categoryCode !== '' && !reference.categoryCodes.has(categoryCode)) {
      errors.push({
        row: rowNumber,
        column: 'categoryCode',
        code: 'unknown_category',
        hint: categoryCode,
      });
    }

    const vatCode = text(row, 'vatCode');
    if (vatCode !== '' && !reference.vatCodes.has(vatCode)) {
      errors.push({ row: rowNumber, column: 'vatCode', code: 'unknown_vat', hint: vatCode });
    }

    // Правило 1: деньги 2 знака. Правило 2: количества 3 знака.
    const priceWithoutVat = parseDecimal(
      text(row, 'priceWithoutVat'),
      2,
      rowNumber,
      'priceWithoutVat',
      errors,
      '0',
    );
    const packSize = parseDecimal(text(row, 'packSize'), 3, rowNumber, 'packSize', errors, '1');
    const minBatch = parseDecimal(text(row, 'minBatch'), 3, rowNumber, 'minBatch', errors, '1');
    const stock = parseDecimal(text(row, 'stock'), 3, rowNumber, 'stock', errors, '0');
    const expiresAt = parseDate(text(row, 'expiresAt'), rowNumber, errors);

    const parsed: ParsedRow = {
      row: rowNumber,
      barcode,
      nameRu: text(row, 'nameRu'),
      nameKk: text(row, 'nameKk'),
      sku: text(row, 'sku') || null,
      brand: text(row, 'brand') || null,
      categoryCode: categoryCode || null,
      manufacturer: text(row, 'manufacturer') || null,
      country: text(row, 'country') || null,
      unitCode,
      packSize,
      minBatch,
      priceWithoutVat,
      vatCode,
      stock,
      expiresAt,
      isMarked: parseBoolean(text(row, 'isMarked'), rowNumber, 'isMarked', errors),
      isExcise: parseBoolean(text(row, 'isExcise'), rowNumber, 'isExcise', errors),
      requiresSnt: parseBoolean(text(row, 'requiresSnt'), rowNumber, 'requiresSnt', errors),
      isLicensed: parseBoolean(text(row, 'isLicensed'), rowNumber, 'isLicensed', errors),
      tnvedCode: text(row, 'tnvedCode') || null,
      photoUrl: parsePhotoUrl(text(row, 'photoUrl'), rowNumber, errors),
    };

    if (errors.length === errorsBefore) rows.push(parsed);
  }

  if (rows.length === 0 && errors.length === 0) {
    errors.push({ row: 0, column: 'file', code: 'empty_file' });
  }

  return { rows, errors };
}
