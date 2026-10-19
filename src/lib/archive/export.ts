import ExcelJS from 'exceljs';
import type { ArchiveRow } from './search';
import type { ReceivableRow } from '@/lib/settlements/receivables';
import type { SettlementRow } from '@/lib/settlements/receivables';

type Column = { header: string; key: string; width: number };

async function build(sheetName: string, columns: Column[], rows: object[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Реестр документов в Excel (раздел 4.4 ТЗ). */
export function exportDocuments(rows: ArchiveRow[], labels: Record<string, string>) {
  return build(
    labels.sheet ?? 'Документы',
    [
      { header: labels.number ?? 'Номер', key: 'number', width: 22 },
      { header: labels.type ?? 'Тип', key: 'type', width: 22 },
      { header: labels.date ?? 'Дата', key: 'issuedAt', width: 14 },
      { header: labels.counterparty ?? 'Контрагент', key: 'counterpartyName', width: 32 },
      { header: labels.order ?? 'Заявка', key: 'orderNumber', width: 20 },
      { header: labels.total ?? 'Сумма с НДС', key: 'totalWithVat', width: 16 },
    ],
    rows.map((row) => ({ ...row, type: labels[row.type] ?? row.type })),
  );
}

/** Выгрузка дебиторки (раздел 4.4 ТЗ). */
export function exportReceivables(rows: ReceivableRow[], labels: Record<string, string>) {
  return build(
    labels.sheet ?? 'Дебиторка',
    [
      { header: labels.order ?? 'Заявка', key: 'orderNumber', width: 20 },
      { header: labels.store ?? 'Магазин', key: 'storeName', width: 32 },
      { header: labels.dueDate ?? 'Срок оплаты', key: 'dueDate', width: 16 },
      { header: labels.amount ?? 'Сумма', key: 'amount', width: 16 },
      { header: labels.overdueDays ?? 'Просрочка, дней', key: 'daysOverdue', width: 18 },
    ],
    rows,
  );
}

/** Выгрузка акта сверки (раздел 4.4 ТЗ). */
export function exportSettlement(rows: SettlementRow[], labels: Record<string, string>) {
  return build(
    labels.sheet ?? 'Акт сверки',
    [
      { header: labels.date ?? 'Дата', key: 'date', width: 14 },
      { header: labels.document ?? 'Документ', key: 'document', width: 24 },
      { header: labels.debit ?? 'Дебет', key: 'debit', width: 16 },
      { header: labels.credit ?? 'Кредит', key: 'credit', width: 16 },
    ],
    rows,
  );
}

/** Выгрузка остатков магазина (раздел 4.4 ТЗ). */
export function exportStock(
  rows: { nameRu: string; barcode: string; quantity: string; averageCost: string }[],
  labels: Record<string, string>,
) {
  return build(
    labels.sheet ?? 'Остатки',
    [
      { header: labels.name ?? 'Товар', key: 'nameRu', width: 36 },
      { header: labels.barcode ?? 'Штрихкод', key: 'barcode', width: 20 },
      { header: labels.quantity ?? 'Остаток', key: 'quantity', width: 14 },
      { header: labels.cost ?? 'Себестоимость', key: 'averageCost', width: 18 },
    ],
    rows,
  );
}
