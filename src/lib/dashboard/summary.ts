import Decimal from 'decimal.js';
import type { OrderStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';

const IN_PROGRESS: OrderStatus[] = [
  'SENT',
  'ACCEPTED',
  'CHANGED_BY_SUPPLIER',
  'PICKING',
  'SHIPPED',
  'DELIVERED',
];
const UNPAID: OrderStatus[] = ['AWAITING_PAYMENT', 'OVERDUE'];

export type DashboardSummary = {
  ordersInProgress: number;
  newOrders: number;
  toShip: number;
  unpaidTotal: string;
  overdueCount: number;
  lowStock: number;
  activeOffers: number;
  salesToday: string;
  receiptsToday: number;
  recentOrders: {
    id: string;
    number: string;
    status: OrderStatus;
    counterparty: string;
    total: string;
  }[];
};

function sum(values: { totalWithVat: Decimal.Value | { toString(): string } }[]) {
  return values
    .reduce((total, row) => total.plus(row.totalWithVat.toString()), new Decimal(0))
    .toFixed(2);
}

/**
 * Сводка кабинета: что требует внимания сегодня. Правило 4: всё считается
 * только по заявкам, остаткам и чекам своей компании.
 */
export async function getDashboardSummary(companyId: string): Promise<DashboardSummary> {
  const startOfDay = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00+05:00');
  const mine = { OR: [{ storeId: companyId }, { supplierId: companyId }] };

  const [inProgress, newOrders, toShip, unpaid, overdue, balances, offers, receipts, recent] =
    await Promise.all([
      prisma.order.count({ where: { ...mine, status: { in: IN_PROGRESS } } }),
      prisma.order.count({ where: { supplierId: companyId, status: 'SENT' } }),
      prisma.order.count({
        where: { supplierId: companyId, status: { in: ['ACCEPTED', 'PICKING'] } },
      }),
      prisma.order.findMany({
        where: { ...mine, status: { in: UNPAID } },
        select: { totalWithVat: true },
      }),
      prisma.order.count({ where: { ...mine, status: 'OVERDUE' } }),
      prisma.stockBalance.findMany({
        where: { location: { companyId }, minQuantity: { not: null } },
        select: { quantity: true, minQuantity: true },
      }),
      prisma.supplierOffer.count({ where: { supplierId: companyId, isActive: true } }),
      prisma.receipt.findMany({
        where: { companyId, createdAt: { gte: startOfDay } },
        select: { total: true, refundOf: true },
      }),
      prisma.order.findMany({
        where: { ...mine, status: { not: 'DRAFT' } },
        include: { store: { select: { name: true } }, supplier: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);

  const sales = receipts.reduce(
    (total, receipt) =>
      receipt.refundOf
        ? total.minus(receipt.total.toString())
        : total.plus(receipt.total.toString()),
    new Decimal(0),
  );

  return {
    ordersInProgress: inProgress,
    newOrders,
    toShip,
    unpaidTotal: sum(unpaid),
    overdueCount: overdue,
    lowStock: balances.filter((row) => row.minQuantity && row.quantity.lessThan(row.minQuantity))
      .length,
    activeOffers: offers,
    salesToday: sales.toFixed(2),
    receiptsToday: receipts.filter((receipt) => !receipt.refundOf).length,
    recentOrders: recent.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      counterparty: order.storeId === companyId ? order.supplier.name : order.store.name,
      total: order.totalWithVat.toFixed(2),
    })),
  };
}
