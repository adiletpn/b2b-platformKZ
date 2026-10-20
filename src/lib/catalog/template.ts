import ExcelJS from 'exceljs';
import { CATALOG_COLUMNS } from './columns';

export type TemplateReference = {
  units: { code: string; name: string }[];
  categories: { code: string; name: string }[];
  vatRates: { code: string; name: string; rate: string }[];
};

/**
 * Шаблон каталога для поставщика: пустой лист для товаров, лист с примером и лист
 * со справочниками. Пример лежит отдельно: загружается только первый лист, и
 * поставщик, не стерев пример, не получит в каталоге чужое молоко.
 */
export async function buildCatalogTemplate(
  reference: TemplateReference,
  locale: 'ru' | 'kk',
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Каталог');
  const exampleSheet = workbook.addWorksheet(locale === 'kk' ? 'Мысал' : 'Пример');

  for (const target of [sheet, exampleSheet]) {
    target.columns = CATALOG_COLUMNS.map((column) => ({
      header: locale === 'kk' ? column.titleKk : column.titleRu,
      key: column.key,
      width: column.width,
    }));

    const header = target.getRow(1);
    header.font = { bold: true };
    header.alignment = { wrapText: true, vertical: 'middle' };
    header.height = 32;

    // Обязательные колонки подсвечены — на это ссылается подсказка на экране каталога.
    CATALOG_COLUMNS.forEach((column, index) => {
      if (column.required) {
        target.getCell(1, index + 1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE8F0FE' },
        };
      }
    });
  }

  const example = {
    barcode: '4870204391234',
    nameRu: 'Молоко 2,5%, 1 л',
    nameKk: 'Сүт 2,5%, 1 л',
    sku: 'MLK-001',
    brand: 'Дала',
    categoryCode: reference.categories[0]?.code ?? '',
    manufacturer: 'ТОО «Пример»',
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
  exampleSheet.addRow(example);

  const refSheet = workbook.addWorksheet(locale === 'kk' ? 'Анықтамалықтар' : 'Справочники');
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
