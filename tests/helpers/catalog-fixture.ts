import ExcelJS from 'exceljs';
import { CATALOG_COLUMNS } from '@/lib/catalog/columns';

export type FixtureRow = Record<string, string | number>;

/** Контрольная цифра GTIN — чтобы фикстуры проходили валидацию. */
export function gtin13(prefix12: string): string {
  const digits = [...prefix12].map(Number);
  const sum = digits.reduce((acc, digit, index) => acc + digit * (index % 2 === 0 ? 1 : 3), 0);
  return `${prefix12}${(10 - (sum % 10)) % 10}`;
}

export function validRow(index: number, overrides: FixtureRow = {}): FixtureRow {
  return {
    barcode: gtin13(String(487020400000 + index)),
    nameRu: `Тестовый товар ${index}`,
    nameKk: `Сынақ тауары ${index}`,
    sku: `SKU-${index}`,
    brand: 'Дала',
    categoryCode: 'grocery',
    manufacturer: 'ТОО «Дала Сут» (тест)',
    country: 'Казахстан',
    unitCode: 'pcs',
    packSize: 12,
    minBatch: 12,
    priceWithoutVat: 450 + index,
    vatCode: 'vat-16',
    stock: 100,
    expiresAt: '31.12.2026',
    isMarked: 'нет',
    isExcise: 'нет',
    requiresSnt: 'нет',
    isLicensed: 'нет',
    tnvedCode: '0401201100',
    ...overrides,
  };
}

export async function buildCatalogXlsx(rows: FixtureRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Каталог');
  sheet.columns = CATALOG_COLUMNS.map((column) => ({ header: column.titleRu, key: column.key }));
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** ExcelJS отдаёт Buffer; парсеру нужен чистый ArrayBuffer. */
export function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
