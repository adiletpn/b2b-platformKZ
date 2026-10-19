import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { paymentDiscipline, type PaymentDiscipline } from './criteria';

/** Раздел 3.8 ТЗ: рейтинг считается за последние 12 месяцев. */
export const RATING_WINDOW_MONTHS = 12;

export function windowStart(now = new Date()) {
  const start = new Date(now);
  start.setMonth(start.getMonth() - RATING_WINDOW_MONTHS);
  return start;
}

/** Новые компании помечаются «мало оценок» (раздел 3.8 ТЗ). */
export const FEW_RATINGS_THRESHOLD = 3;

export type SupplierMetrics = {
  fulfilledShare: string;
  onTimeShare: string;
  discrepancyShare: string;
};

export type StoreMetrics = {
  averagePaymentDelayDays: string;
  discipline: PaymentDiscipline;
  cancelledShare: string;
  discrepancyShare: string;
};

export type CompanyRating = {
  manualScore: string | null;
  ratingsCount: number;
  fewRatings: boolean;
  supplier: SupplierMetrics | null;
  store: StoreMetrics | null;
};

function share(part: number, total: number): string {
  if (total === 0) return '0.00';
  return new Decimal(part).div(total).times(100).toDecimalPlaces(2).toFixed(2);
}

/** Автоматические метрики поставщика: их нельзя накрутить вручную. */
async function supplierMetrics(companyId: string, since: Date): Promise<SupplierMetrics> {
  const orders = await prisma.order.findMany({
    where: { supplierId: companyId, createdAt: { gte: since } },
    include: { items: true, statusLogs: true },
  });
  if (orders.length === 0) {
    return { fulfilledShare: '0.00', onTimeShare: '0.00', discrepancyShare: '0.00' };
  }

  let ordered = new Decimal(0);
  let confirmed = new Decimal(0);
  let onTime = 0;
  let withDelivery = 0;
  let withDiscrepancy = 0;

  for (const order of orders) {
    for (const item of order.items) {
      ordered = ordered.plus(item.quantityOrdered.toString());
      confirmed = confirmed.plus((item.quantityConfirmed ?? item.quantityOrdered).toString());
    }

    const delivered = order.statusLogs.find((log) => log.toStatus === 'DELIVERED');
    if (delivered && order.deliveryDate) {
      withDelivery += 1;
      if (delivered.createdAt <= new Date(order.deliveryDate.getTime() + 86_400_000)) onTime += 1;
    }

    if (order.status === 'ACCEPTED_WITH_DISCREPANCY') withDiscrepancy += 1;
  }

  return {
    fulfilledShare: ordered.isZero()
      ? '0.00'
      : confirmed.div(ordered).times(100).toDecimalPlaces(2).toFixed(2),
    onTimeShare: share(onTime, withDelivery),
    discrepancyShare: share(withDiscrepancy, orders.length),
  };
}

/** Автоматические метрики магазина, главная — платёжная дисциплина. */
async function storeMetrics(companyId: string, since: Date): Promise<StoreMetrics> {
  const orders = await prisma.order.findMany({
    where: { storeId: companyId, createdAt: { gte: since } },
    include: { payments: true, statusLogs: true },
  });

  let delaySum = new Decimal(0);
  let paidCount = 0;
  let cancelled = 0;
  let discrepancy = 0;

  for (const order of orders) {
    if (order.status === 'CANCELLED') cancelled += 1;
    if (order.status === 'ACCEPTED_WITH_DISCREPANCY') discrepancy += 1;

    const payment = order.payments[0];
    const awaiting = order.statusLogs.find((log) => log.toStatus === 'AWAITING_PAYMENT');
    if (!payment || !awaiting) continue;

    const days = new Decimal(payment.paidAt.getTime() - awaiting.createdAt.getTime())
      .div(86_400_000)
      .toDecimalPlaces(2);
    delaySum = delaySum.plus(Decimal.max(days, 0));
    paidCount += 1;
  }

  const average = paidCount === 0 ? new Decimal(0) : delaySum.div(paidCount).toDecimalPlaces(2);

  return {
    averagePaymentDelayDays: average.toFixed(2),
    discipline: paymentDiscipline(average.toNumber()),
    cancelledShare: share(cancelled, orders.length),
    discrepancyShare: share(discrepancy, orders.length),
  };
}

/** Рейтинг компании: ручные оценки плюс автоматические метрики за 12 месяцев. */
export async function getCompanyRating(
  companyId: string,
  now = new Date(),
): Promise<CompanyRating> {
  const since = windowStart(now);
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

  const ratings = await prisma.rating.findMany({
    where: { targetCompanyId: companyId, createdAt: { gte: since } },
  });

  const manualScore =
    ratings.length === 0
      ? null
      : ratings
          .reduce((acc, rating) => acc.plus(rating.score.toString()), new Decimal(0))
          .div(ratings.length)
          .toDecimalPlaces(2)
          .toFixed(2);

  return {
    manualScore,
    ratingsCount: ratings.length,
    fewRatings: ratings.length < FEW_RATINGS_THRESHOLD,
    supplier: company.type === 'STORE' ? null : await supplierMetrics(companyId, since),
    store: company.type === 'SUPPLIER' ? null : await storeMetrics(companyId, since),
  };
}
