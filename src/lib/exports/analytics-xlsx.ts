import ExcelJS from 'exceljs';
import type { StoreAnalytics, SupplierAnalytics } from '@/lib/analytics/analytics';

const MONEY = '#,##0.00';
const QUANTITY = '#,##0.###';

type Labels = Record<string, string>;

/** Лист с заголовком и строками; числа кладутся числами, источник — строки Decimal. */
function sheet(
  workbook: ExcelJS.Workbook,
  title: string,
  header: string[],
  rows: (string | number)[][],
  formats: (string | undefined)[],
) {
  const worksheet = workbook.addWorksheet(title.slice(0, 31));
  worksheet.addRow(header).font = { bold: true };
  for (const row of rows) worksheet.addRow(row);
  worksheet.columns = header.map((_, index) => ({
    width: index === 0 ? 36 : 16,
    style: formats[index] ? { numFmt: formats[index] } : {},
  }));
}

/** Аналитика за период в Excel (этап 3 ТЗ): по листу на каждый отчёт экрана. */
export async function analyticsXlsx(
  store: StoreAnalytics | null,
  supplier: SupplierAnalytics | null,
  labels: Labels,
  locale: 'ru' | 'kk',
) {
  const workbook = new ExcelJS.Workbook();
  const label = (key: string) => labels[key] ?? key;
  const name = (row: { nameRu: string; nameKk: string }) =>
    (locale === 'kk' ? row.nameKk : row.nameRu) || label('noCategory');

  if (store) {
    sheet(
      workbook,
      label('byDay'),
      [label('day'), label('revenue'), label('profit')],
      store.byDay.map((row) => [row.day, Number(row.revenue), Number(row.profit)]),
      [undefined, MONEY, MONEY],
    );
    sheet(
      workbook,
      label('byCategory'),
      [label('category'), label('revenue'), label('profit')],
      store.byCategory.map((row) => [name(row), Number(row.revenue), Number(row.profit)]),
      [undefined, MONEY, MONEY],
    );
    sheet(
      workbook,
      label('abc'),
      [label('product'), label('revenue'), label('share'), label('group')],
      store.abc.map((row) => [name(row), Number(row.revenue), Number(row.share), row.group]),
      [undefined, MONEY, '0.0', undefined],
    );
    sheet(
      workbook,
      label('turnover'),
      [label('product'), label('stock'), label('sold'), label('daysOfStock'), label('stale')],
      store.turnover.map((row) => [
        name(row),
        Number(row.stock),
        Number(row.sold),
        row.daysOfStock === null ? '' : Number(row.daysOfStock),
        row.stale ? label('yes') : '',
      ]),
      [undefined, QUANTITY, QUANTITY, '0.0', undefined],
    );
  }
  if (supplier) {
    sheet(
      workbook,
      label('byStore'),
      [label('store'), label('orders'), label('turnoverTotal')],
      supplier.byStore.map((row) => [row.name, row.orders, Number(row.amount)]),
      [undefined, undefined, MONEY],
    );
    sheet(
      workbook,
      label('byProduct'),
      [label('product'), label('quantity'), label('turnoverTotal')],
      supplier.byProduct.map((row) => [name(row), Number(row.quantity), Number(row.amount)]),
      [undefined, QUANTITY, MONEY],
    );
    sheet(
      workbook,
      label('fulfillment'),
      [label('fulfillment'), label('fulfilled'), label('notFulfilled')],
      [
        [
          supplier.fulfillmentShare === null ? '' : Number(supplier.fulfillmentShare),
          supplier.fulfilled,
          supplier.notFulfilled,
        ],
      ],
      ['0.0', undefined, undefined],
    );
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
