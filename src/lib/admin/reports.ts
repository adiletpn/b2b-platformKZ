import ExcelJS from 'exceljs';
import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';

/** Отчёты админки в Excel (раздел 3.13 ТЗ): компании, заявки, обороты по городам. */
export const REPORT_KINDS = ['companies', 'orders', 'cities'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

type Column = { header: string; key: string; width: number };

async function book(sheet: string, columns: Column[], rows: object[]) {
  const workbook = new ExcelJS.Workbook();
  const page = workbook.addWorksheet(sheet);
  page.columns = columns;
  page.getRow(1).font = { bold: true };
  for (const row of rows) page.addRow(row);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** `labels` — заголовки на языке админки; деньги уходят строками с двумя знаками (правило 1). */
export async function buildReport(
  kind: ReportKind,
  labels: Record<string, string>,
  period: { from: Date; to: Date },
) {
  if (kind === 'companies') {
    const companies = await prisma.company.findMany({
      include: {
        locations: { include: { city: true }, take: 1 },
        subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    return book(
      labels.companies ?? 'companies',
      [
        { header: labels.name ?? 'name', key: 'name', width: 36 },
        { header: labels.bin ?? 'bin', key: 'bin', width: 16 },
        { header: labels.type ?? 'type', key: 'type', width: 12 },
        { header: labels.city ?? 'city', key: 'city', width: 18 },
        { header: labels.status ?? 'status', key: 'status', width: 16 },
        { header: labels.plan ?? 'plan', key: 'plan', width: 16 },
        { header: labels.createdAt ?? 'createdAt', key: 'createdAt', width: 14 },
      ],
      companies.map((company) => ({
        name: company.name,
        bin: company.bin,
        type: company.type,
        city: company.locations[0]?.city.nameRu ?? '',
        status: company.verificationStatus,
        plan: company.subscriptions[0]?.plan.code ?? '',
        createdAt: company.createdAt.toISOString().slice(0, 10),
      })),
    );
  }

  const orders = await prisma.order.findMany({
    where: { status: { not: 'DRAFT' }, createdAt: { gte: period.from, lte: period.to } },
    include: {
      store: { select: { name: true } },
      supplier: { select: { name: true } },
      location: { include: { city: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (kind === 'orders') {
    return book(
      labels.orders ?? 'orders',
      [
        { header: labels.number ?? 'number', key: 'number', width: 20 },
        { header: labels.date ?? 'date', key: 'date', width: 14 },
        { header: labels.store ?? 'store', key: 'store', width: 32 },
        { header: labels.supplier ?? 'supplier', key: 'supplier', width: 32 },
        { header: labels.city ?? 'city', key: 'city', width: 16 },
        { header: labels.status ?? 'status', key: 'status', width: 22 },
        { header: labels.total ?? 'total', key: 'total', width: 14 },
      ],
      orders.map((order) => ({
        number: order.number,
        date: order.createdAt.toISOString().slice(0, 10),
        store: order.store.name,
        supplier: order.supplier.name,
        city: order.location.city.nameRu,
        status: order.status,
        total: order.totalWithVat.toFixed(2),
      })),
    );
  }

  const byCity = new Map<string, { orders: number; gmv: Decimal }>();
  for (const order of orders) {
    if (order.status === 'CANCELLED' || order.status === 'REJECTED') continue;
    const row = byCity.get(order.location.city.nameRu) ?? { orders: 0, gmv: new Decimal(0) };
    byCity.set(order.location.city.nameRu, {
      orders: row.orders + 1,
      gmv: row.gmv.plus(order.totalWithVat.toString()),
    });
  }
  return book(
    labels.cities ?? 'cities',
    [
      { header: labels.city ?? 'city', key: 'city', width: 20 },
      { header: labels.ordersCount ?? 'orders', key: 'orders', width: 12 },
      { header: labels.gmv ?? 'gmv', key: 'gmv', width: 16 },
    ],
    [...byCity.entries()]
      .sort((a, b) => b[1].gmv.comparedTo(a[1].gmv))
      .map(([city, row]) => ({ city, orders: row.orders, gmv: row.gmv.toFixed(2) })),
  );
}
