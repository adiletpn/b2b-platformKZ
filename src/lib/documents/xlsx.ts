import ExcelJS from 'exceljs';
import type { DocumentType } from '@/generated/prisma/enums';
import type { DocumentParty, DocumentPayload } from './payload';
import { LABELS, type Locale } from './templates';

const MONEY = '#,##0.00';
const QUANTITY = '#,##0.###';

function title(type: DocumentType, locale: Locale) {
  const t = LABELS[locale];
  switch (type) {
    case 'WAYBILL':
      return `${t.waybillTitle} (${t.waybillForm})`;
    case 'INVOICE':
      return t.invoiceTitle;
    case 'RETURN_WAYBILL':
      return t.returnTitle;
    default:
      return t.actTitle;
  }
}

/** Числа в Excel кладём числами: бухгалтер считает по ним формулами. Источник — строки Decimal. */
function num(value: string) {
  return Number(value);
}

/**
 * Документ в Excel (раздел 4.3 ТЗ: «PDF и Excel»). Данные — из того же снимка, что и PDF,
 * поэтому версии совпадают. Суммы не пересчитываются, а берутся из документа (правило 1).
 */
export async function documentXlsx(
  type: DocumentType,
  payload: DocumentPayload,
  locale: Locale,
): Promise<Buffer> {
  const t = LABELS[locale];
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(payload.number.slice(0, 31));
  sheet.columns = [
    { width: 6 },
    { width: 44 },
    { width: 10 },
    { width: 12 },
    { width: 14 },
    { width: 9 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
  ];

  sheet.addRow([`${title(type, locale)} № ${payload.number}`]).font = { bold: true, size: 14 };
  sheet.addRow([
    `${t.date}: ${payload.issuedAt.slice(0, 10)}`,
    '',
    '',
    `${t.order}: ${payload.orderNumber}`,
  ]);
  if (payload.correction) {
    sheet.addRow([`v${payload.correction.version}: ${payload.correction.reason}`]);
  }
  sheet.addRow([]);

  const party = (label: string, value: DocumentParty) => {
    sheet.addRow([label, value.name]).getCell(1).font = { bold: true };
    sheet.addRow([t.bin, value.bin]);
    sheet.addRow([t.address, value.legalAddress]);
    if (value.iik)
      sheet.addRow([t.iik, `${value.iik} · ${t.bik} ${value.bik ?? ''} · ${value.bankName ?? ''}`]);
  };
  party(t.supplier, payload.supplier);
  party(t.store, payload.store);
  sheet.addRow([t.deliveryAddress, payload.deliveryAddress]);
  sheet.addRow([]);

  if (type === 'DISCREPANCY_ACT' && payload.discrepancies) {
    const header = sheet.addRow([
      t.position,
      t.name,
      t.shipped,
      t.accepted,
      t.defective,
      '',
      t.mismatch,
      t.totalWithVat,
    ]);
    header.font = { bold: true };
    for (const line of payload.discrepancies) {
      const row = sheet.addRow([
        line.position,
        locale === 'kk' ? line.nameKk : line.nameRu,
        num(line.quantityShipped),
        num(line.quantityAccepted),
        num(line.quantityDefective),
        '',
        num(line.quantityMismatch),
        num(line.amountDifference),
      ]);
      for (const cell of [3, 4, 5, 7]) row.getCell(cell).numFmt = QUANTITY;
      row.getCell(8).numFmt = MONEY;
    }
    sheet.addRow([]);
  }

  const header = sheet.addRow([
    t.position,
    t.name,
    t.unit,
    t.quantity,
    t.price,
    t.vatRate,
    t.vatAmount,
    t.totalWithoutVat,
    t.totalWithVat,
  ]);
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F5' } };
    cell.alignment = { wrapText: true, vertical: 'middle' };
  });
  for (const line of payload.lines) {
    const row = sheet.addRow([
      line.position,
      locale === 'kk' ? line.nameKk : line.nameRu,
      locale === 'kk' ? line.unitKk : line.unitRu,
      num(line.quantity),
      num(line.priceWithoutVat),
      num(line.vatRate),
      num(line.vatAmount),
      num(line.totalWithoutVat),
      num(line.totalWithVat),
    ]);
    row.getCell(4).numFmt = QUANTITY;
    for (const cell of [5, 7, 8, 9]) row.getCell(cell).numFmt = MONEY;
  }
  const totals = sheet.addRow([
    '',
    t.totals,
    '',
    '',
    '',
    '',
    num(payload.vatAmount),
    num(payload.totalWithoutVat),
    num(payload.totalWithVat),
  ]);
  totals.font = { bold: true };
  for (const cell of [7, 8, 9]) totals.getCell(cell).numFmt = MONEY;
  if (!payload.supplier.isVatPayer) sheet.addRow(['', t.notVatPayer]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
