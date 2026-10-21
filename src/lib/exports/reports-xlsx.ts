import ExcelJS from 'exceljs';
import { prisma } from '@/lib/prisma';
import type { LedgerEntry } from '@/lib/stock/documents';

const MONEY = '#,##0.00';
const QUANTITY = '#,##0.###';

type Labels = Record<string, string>;

/** Числа кладём числами, чтобы бухгалтер считал формулами. Источник — строки Decimal (правило 1). */
function num(value: string) {
  return Number(value);
}

/** Дата и время по Казахстану: в выгрузке те же часы, что на экране. */
function localTime(iso: string) {
  return new Date(new Date(iso).getTime() + 5 * 3_600_000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');
}

/** Журнал движения по товару в Excel (раздел 4.4 ТЗ: «отчёты в Excel»). */
export async function ledgerXlsx(entries: LedgerEntry[], productName: string, labels: Labels) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(labels.ledger ?? 'ledger');
  sheet.addRow([productName]).font = { bold: true, size: 13 };
  sheet.addRow([]);
  const header = sheet.addRow([
    labels.date,
    labels.type,
    labels.quantity,
    labels.costPrice,
    labels.location,
    labels.document,
    labels.author,
  ]);
  header.font = { bold: true };
  for (const entry of entries) {
    sheet.addRow([
      localTime(entry.createdAt),
      labels[`type_${entry.type}`] ?? entry.type,
      num(entry.quantity),
      num(entry.costPrice),
      entry.locationAddress,
      entry.documentNumber ?? '',
      entry.author ?? '',
    ]);
  }
  sheet.columns = [
    { width: 18 },
    { width: 18 },
    { width: 12, style: { numFmt: QUANTITY } },
    { width: 14, style: { numFmt: MONEY } },
    { width: 36 },
    { width: 18 },
    { width: 22 },
  ];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Продажи за период в Excel (разделы 4.2 и 4.4 ТЗ): лист чеков и лист товаров.
 * Правило 4: только чеки своей компании и разрешённых сотруднику точек.
 */
export async function salesXlsx(
  companyId: string,
  period: { from: Date; to: Date },
  allowedLocationIds: string[],
  labels: Labels,
  locale: 'ru' | 'kk',
) {
  const receipts = await prisma.receipt.findMany({
    where: {
      companyId,
      createdAt: { gte: period.from, lte: period.to },
      ...(allowedLocationIds.length > 0 ? { locationId: { in: allowedLocationIds } } : {}),
    },
    include: {
      location: { select: { address: true } },
      user: { select: { name: true } },
      items: { include: { product: { select: { nameRu: true, nameKk: true, barcode: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const workbook = new ExcelJS.Workbook();
  const checks = workbook.addWorksheet(labels.receipts ?? 'receipts');
  checks.columns = [
    { header: labels.number, width: 14 },
    { header: labels.date, width: 18 },
    { header: labels.location, width: 32 },
    { header: labels.cashier, width: 22 },
    { header: labels.payment, width: 14 },
    { header: labels.kind, width: 12 },
    { header: labels.discount, width: 14, style: { numFmt: MONEY } },
    { header: labels.total, width: 14, style: { numFmt: MONEY } },
    { header: labels.cost, width: 14, style: { numFmt: MONEY } },
  ];
  checks.getRow(1).font = { bold: true };

  const items = workbook.addWorksheet(labels.items ?? 'items');
  items.columns = [
    { header: labels.number, width: 14 },
    { header: labels.date, width: 18 },
    { header: labels.barcode, width: 16 },
    { header: labels.product, width: 40 },
    { header: labels.quantity, width: 12, style: { numFmt: QUANTITY } },
    { header: labels.price, width: 14, style: { numFmt: MONEY } },
    { header: labels.discount, width: 14, style: { numFmt: MONEY } },
    { header: labels.total, width: 14, style: { numFmt: MONEY } },
  ];
  items.getRow(1).font = { bold: true };

  for (const receipt of receipts) {
    // Возврат — отдельный чек со ссылкой на исходный, суммы в нём положительные.
    const kind = receipt.refundOf ? labels.refund : labels.sale;
    const date = localTime(receipt.createdAt.toISOString());
    checks.addRow([
      receipt.number,
      date,
      receipt.location.address,
      receipt.user?.name ?? '',
      labels[`payment_${receipt.paymentType}`] ?? receipt.paymentType,
      kind,
      num(receipt.discountTotal.toFixed(2)),
      num(receipt.total.toFixed(2)),
      num(receipt.costTotal.toFixed(2)),
    ]);
    for (const item of receipt.items) {
      items.addRow([
        receipt.number,
        date,
        item.product.barcode,
        locale === 'kk' ? item.product.nameKk : item.product.nameRu,
        num(item.quantity.toFixed(3)),
        num(item.price.toFixed(2)),
        num(item.discount.toFixed(2)),
        num(item.total.toFixed(2)),
      ]);
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
