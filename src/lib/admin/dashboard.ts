import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';

export type DashboardMetrics = {
  newCompaniesToday: number;
  activeStores: number;
  activeSuppliers: number;
  ordersToday: number;
  gmvToday: string;
  gmvMonth: string;
  conversion: string;
  openDisputes: number;
  pendingVerifications: number;
  byCity: { city: string; orders: number; gmv: string }[];
};

function startOfDay(now: Date) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Дашборд платформы: компании, заявки, оборот и споры (раздел 3.13 ТЗ). */
export async function getDashboard(now = new Date()): Promise<DashboardMetrics> {
  const dayStart = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [companiesToday, companies, ordersToday, ordersMonth, disputes, pending, orderCities] =
    await Promise.all([
      prisma.company.count({ where: { createdAt: { gte: dayStart } } }),
      prisma.company.findMany({ select: { id: true, type: true } }),
      prisma.order.findMany({
        where: { createdAt: { gte: dayStart }, status: { not: 'DRAFT' } },
        select: { totalWithVat: true },
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: monthStart }, status: { not: 'DRAFT' } },
        select: { totalWithVat: true },
      }),
      prisma.order.count({ where: { status: 'DISPUTE' } }),
      prisma.verificationRequest.count({ where: { status: 'PENDING' } }),
      prisma.order.findMany({
        where: { status: { not: 'DRAFT' } },
        select: {
          totalWithVat: true,
          location: { select: { city: { select: { nameRu: true } } } },
        },
      }),
    ]);

  const storesWithOrders = await prisma.order.groupBy({
    by: ['storeId'],
    where: { status: { not: 'DRAFT' } },
  });

  const sum = (rows: { totalWithVat: Decimal }[]) =>
    rows.reduce((acc, row) => acc.plus(row.totalWithVat.toString()), new Decimal(0)).toFixed(2);

  const stores = companies.filter((company) => company.type !== 'SUPPLIER').length;
  const suppliers = companies.filter((company) => company.type !== 'STORE').length;

  const cityTotals = new Map<string, { orders: number; gmv: Decimal }>();
  for (const order of orderCities) {
    const city = order.location.city.nameRu;
    const current = cityTotals.get(city) ?? { orders: 0, gmv: new Decimal(0) };
    cityTotals.set(city, {
      orders: current.orders + 1,
      gmv: current.gmv.plus(order.totalWithVat.toString()),
    });
  }

  return {
    newCompaniesToday: companiesToday,
    activeStores: stores,
    activeSuppliers: suppliers,
    ordersToday: ordersToday.length,
    gmvToday: sum(ordersToday),
    gmvMonth: sum(ordersMonth),
    // Конверсия «зарегистрировался → первая заявка» (раздел 3.13 ТЗ).
    conversion:
      stores === 0
        ? '0.00'
        : new Decimal(storesWithOrders.length).div(stores).times(100).toDecimalPlaces(2).toFixed(2),
    openDisputes: disputes,
    pendingVerifications: pending,
    byCity: [...cityTotals.entries()]
      .map(([city, data]) => ({ city, orders: data.orders, gmv: data.gmv.toFixed(2) }))
      .sort((left, right) => Number(right.gmv) - Number(left.gmv))
      .slice(0, 10),
  };
}

export type DisputeRow = {
  orderId: string;
  number: string;
  storeName: string;
  supplierName: string;
  reason: string | null;
  total: string;
};

export async function listDisputes(): Promise<DisputeRow[]> {
  const orders = await prisma.order.findMany({
    where: { status: 'DISPUTE' },
    include: { store: { select: { name: true } }, supplier: { select: { name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  return orders.map((order) => ({
    orderId: order.id,
    number: order.number,
    storeName: order.store.name,
    supplierName: order.supplier.name,
    reason: order.disputeReason,
    total: order.totalWithVat.toFixed(2),
  }));
}

export type DisputeResolution = 'AWAITING_PAYMENT' | 'PAID' | 'CANCELLED';

/** Администратор разбирает спор с решением и комментарием для обеих сторон. */
export async function resolveDispute(
  adminId: string,
  orderId: string,
  resolution: DisputeResolution,
  comment: string,
) {
  if (!comment.trim()) return { status: 'comment_required' as const };

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== 'DISPUTE') return { status: 'not_found' as const };

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { status: resolution } });
    await tx.orderStatusLog.create({
      data: {
        orderId,
        fromStatus: 'DISPUTE',
        toStatus: resolution,
        comment: comment.trim(),
      },
    });
  });

  const { writeAdminAudit } = await import('./session');
  await writeAdminAudit(adminId, 'dispute_resolved', {
    entity: 'Order',
    entityId: orderId,
    reason: comment.trim(),
  });

  const { notify } = await import('@/mocks/notifications');
  for (const companyId of [order.storeId, order.supplierId]) {
    await notify(companyId, 'order_status_changed', { number: order.number, status: resolution });
  }

  return { status: 'ok' as const };
}
