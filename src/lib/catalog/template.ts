import ExcelJS from 'exceljs';
import { CATALOG_COLUMNS } from './columns';

export type TemplateReference = {
  units: { code: string; name: string }[];
  categories: { code: string; name: string }[];
  vatRates: { code: string; name: string; rate: string }[];
};

/** Шаблон каталога для поставщика: лист с данными и лист со справочниками. */
export async function buildCatalogTemplate(
  reference: TemplateReference,
  locale: 'ru' | 'kk',
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(locale === 'kk' ? 'Каталог' : 'Каталог');

  sheet.columns = CATALOG_COLUMNS.map((column) => ({
    header: locale === 'kk' ? column.titleKk : column.titleRu,
    key: column.key,
    width: column.width,
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { wrapText: true, vertical: 'middle' };
  header.height = 32;

  CATALOG_COLUMNS.forEach((column, index) => {
    if (column.required) {
      sheet.getCell(1, index + 1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE8F0FE' },
      };
    }
  });

  const example = {
    barcode: '4870204391234',
    nameRu: 'Молоко 2,5%, 1 л',
    nameKk: 'Сүт 2,5%, 1 л',
    sku: 'MLK-001',
    brand: 'Дала',
    categoryCode: reference.categories[0]?.code ?? '',
    manufacturer: 'ТОО «Дала Сут» (тест)',
    country: 'Казахстан',
    unitCode: reference.units[0]?.code ?? '',
    packSize: 12,
    minBatch: 12,
    priceWithoutVat: 450,
    vatCode: reference.vatRates[0]?.code ?? '',
    stock: 240,
    expiresAt: '31.12.2026',
    isMarked: 'нет',
    isExcise: 'нет',
    requiresSnt: 'нет',
    isLicensed: 'нет',
    tnvedCode: '0401201100',
  };
  sheet.addRow(example);

  const refSheet = workbook.addWorksheet('Справочники');
  refSheet.columns = [
    { header: 'Тип', key: 'kind', width: 18 },
    { header: 'Код', key: 'code', width: 18 },
    { header: 'Значение', key: 'name', width: 36 },
  ];
  refSheet.getRow(1).font = { bold: true };

  for (const unit of reference.units) {
    refSheet.addRow({ kind: 'Единица измерения', code: unit.code, name: unit.name });
  }
  for (const category of reference.categories) {
    refSheet.addRow({ kind: 'Категория', code: category.code, name: category.name });
  }
  for (const vat of reference.vatRates) {
    refSheet.addRow({ kind: 'Ставка НДС', code: vat.code, name: `${vat.name} (${vat.rate}%)` });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
