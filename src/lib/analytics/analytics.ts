import Decimal from 'decimal.js';
import type { OrderStatus } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/admin/settings';
import { kzDayKey } from '@/lib/format';
import { getRecommendations, type RecommendationRow } from '@/lib/stock/replenishment';

/**
 * Аналитика этапа 3 ТЗ для магазина и поставщика. Правило 1: суммы считаются Decimal
 * и отдаются строками с двумя знаками. Правило 4: только данные своей компании.
 */
export type Period = { from: Date; to: Date };

const DAY_MS = 86_400_000;

/** Период из строк ГГГГ-ММ-ДД по Казахстану; по умолчанию — последние 30 дней. */
export function parsePeriod(from?: string | null, to?: string | null, now = new Date()): Period {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const toKey = to && day.test(to) ? to : kzDayKey(now);
  const fromKey =
    from && day.test(from) ? from : kzDayKey(new Date(new Date(toKey).getTime() - 29 * DAY_MS));
  // Сутки по Казахстану (UTC+5): с 00:00 первого дня до 23:59:59 последнего.
  const start = new Date(`${fromKey}T00:00:00+05:00`);
  const end = new Date(`${toKey}T23:59:59.999+05:00`);
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

function periodDays(period: Period) {
  return Math.max(1, Math.round((period.to.getTime() - period.from.getTime()) / DAY_MS));
}

const money = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const zero = () => new Decimal(0);

/** Пороги ABC: A — первые 80% выручки, B — до 95%, остальное C. TODO(open-question). */
async function abcThresholds(): Promise<[number, number]> {
  const [a, b] = (await getSetting('analytics_abc_thresholds', '80,95'))
    .split(',')
    .map((part) => Number(part.trim()));
  return a && b && a > 0 && a < b && b <= 100 ? [a, b] : [80, 95];
}

/** Залежавшийся товар: есть остаток, а продаж нет столько дней. TODO(open-question). */
async function staleDays() {
  const value = Number(await getSetting('analytics_stale_days', '30'));
  return Number.isInteger(value) && value > 0 ? value : 30;
}

export type DayRow = { day: string; revenue: string; profit: string };
export type CategoryRow = { nameRu: string; nameKk: string; revenue: string; profit: string };
export type AbcRow = {
  productId: string;
  nameRu: string;
  nameKk: string;
  revenue: string;
  share: string;
  group: 'A' | 'B' | 'C';
};
export type TurnoverRow = {
  productId: string;
  nameRu: string;
  nameKk: string;
  stock: string;
  sold: string;
  /** На сколько дней хватит остатка при продажах периода; пусто — продаж не было. */
  daysOfStock: string | null;
  stale: boolean;
};

export type StoreAnalytics = {
  revenue: string;
  profit: string;
  receipts: number;
  byDay: DayRow[];
  byCategory: CategoryRow[];
  abc: AbcRow[];
  turnover: TurnoverRow[];
  staleDays: number;
  recommendations: RecommendationRow[];
};

/**
 * Магазин: продажи и валовая прибыль по дням и категориям, ABC-анализ товаров,
 * оборачиваемость и залежавшийся товар, рекомендации закупок (из replenishment.ts).
 * Возвраты — чеки с отрицательными суммами, поэтому итоги чистые.
 */
export async function storeAnalytics(
  companyId: string,
  period: Period,
  allowedLocationIds: string[] = [],
  now = new Date(),
): Promise<StoreAnalytics> {
  const locationFilter =
    allowedLocationIds.length > 0 ? { locationId: { in: allowedLocationIds } } : {};
  const receipts = await prisma.receipt.findMany({
    where: { companyId, createdAt: { gte: period.from, lte: period.to }, ...locationFilter },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              nameRu: true,
              nameKk: true,
              category: { select: { nameRu: true, nameKk: true } },
            },
          },
        },
      },
    },
  });

  let revenue = zero();
  let profit = zero();
  const days = new Map<string, { revenue: Decimal; profit: Decimal }>();
  const categories = new Map<
    string,
    { nameRu: string; nameKk: string; revenue: Decimal; cost: Decimal }
  >();
  const products = new Map<
    string,
    { nameRu: string; nameKk: string; revenue: Decimal; sold: Decimal }
  >();

  for (const receipt of receipts) {
    const total = new Decimal(receipt.total.toString());
    const margin = total.minus(receipt.costTotal.toString());
    revenue = revenue.plus(total);
    profit = profit.plus(margin);
    const key = kzDayKey(receipt.createdAt);
    const day = days.get(key) ?? { revenue: zero(), profit: zero() };
    days.set(key, { revenue: day.revenue.plus(total), profit: day.profit.plus(margin) });

    for (const item of receipt.items) {
      const itemTotal = new Decimal(item.total.toString());
      const itemCost = new Decimal(item.costPrice.toString()).times(item.quantity.toString());
      const category = item.product.category;
      const categoryKey = category?.nameRu ?? '';
      const row = categories.get(categoryKey) ?? {
        nameRu: category?.nameRu ?? '',
        nameKk: category?.nameKk ?? '',
        revenue: zero(),
        cost: zero(),
      };
      categories.set(categoryKey, {
        ...row,
        revenue: row.revenue.plus(itemTotal),
        cost: row.cost.plus(itemCost),
      });
      const product = products.get(item.product.id) ?? {
        nameRu: item.product.nameRu,
        nameKk: item.product.nameKk,
        revenue: zero(),
        sold: zero(),
      };
      products.set(item.product.id, {
        ...product,
        revenue: product.revenue.plus(itemTotal),
        sold: product.sold.plus(item.quantity.toString()),
      });
    }
  }

  // ABC: товары по убыванию выручки, группа по накопленной доле.
  const [limitA, limitB] = await abcThresholds();
  const ranked = [...products.entries()]
    .filter(([, row]) => row.revenue.greaterThan(0))
    .sort((left, right) => right[1].revenue.comparedTo(left[1].revenue));
  const positive = ranked.reduce((sum, [, row]) => sum.plus(row.revenue), zero());
  let cumulative = zero();
  const abc: AbcRow[] = ranked.map(([productId, row]) => {
    const before = positive.isZero() ? zero() : cumulative.div(positive).times(100);
    cumulative = cumulative.plus(row.revenue);
    const share = positive.isZero() ? zero() : row.revenue.div(positive).times(100);
    // Группа по доле до товара: первый товар всегда A, даже если он один даёт больше 80%.
    const group = before.lessThan(limitA) ? 'A' : before.lessThan(limitB) ? 'B' : 'C';
    return {
      productId,
      nameRu: row.nameRu,
      nameKk: row.nameKk,
      revenue: money(row.revenue),
      share: share.toDecimalPlaces(1).toFixed(1),
      group,
    };
  });

  // Оборачиваемость: остаток против продаж периода; залежавшийся — без продаж N дней.
  const stale = await staleDays();
  const staleSince = new Date(now.getTime() - stale * DAY_MS);
  const [balances, recentSales] = await Promise.all([
    prisma.stockBalance.findMany({
      where: {
        location: { companyId },
        quantity: { gt: 0 },
        ...locationFilter,
      },
      include: { product: { select: { nameRu: true, nameKk: true } } },
    }),
    prisma.receiptItem.groupBy({
      by: ['productId'],
      where: { receipt: { companyId, createdAt: { gte: staleSince }, ...locationFilter } },
      _sum: { quantity: true },
    }),
  ]);
  const soldRecently = new Set(
    recentSales
      .filter((row) => new Decimal(row._sum.quantity?.toString() ?? '0').greaterThan(0))
      .map((row) => row.productId),
  );
  const stock = new Map<string, { nameRu: string; nameKk: string; quantity: Decimal }>();
  for (const balance of balances) {
    const row = stock.get(balance.productId) ?? {
      nameRu: balance.product.nameRu,
      nameKk: balance.product.nameKk,
      quantity: zero(),
    };
    stock.set(balance.productId, {
      ...row,
      quantity: row.quantity.plus(balance.quantity.toString()),
    });
  }
  const length = periodDays(period);
  const turnover: TurnoverRow[] = [...stock.entries()]
    .map(([productId, row]) => {
      const sold = products.get(productId)?.sold ?? zero();
      const daily = sold.div(length);
      return {
        productId,
        nameRu: row.nameRu,
        nameKk: row.nameKk,
        stock: row.quantity.toFixed(3),
        sold: sold.toFixed(3),
        daysOfStock: daily.greaterThan(0)
          ? row.quantity.div(daily).toDecimalPlaces(1).toFixed(1)
          : null,
        stale: !soldRecently.has(productId),
      };
    })
    .sort(
      (left, right) =>
        Number(right.stale) - Number(left.stale) || left.nameRu.localeCompare(right.nameRu),
    );

  const locations = await prisma.location.findMany({
    where: {
      companyId,
      type: 'STORE',
      ...(allowedLocationIds.length > 0 ? { id: { in: allowedLocationIds } } : {}),
    },
    select: { id: true },
  });
  const recommendations = (
    await Promise.all(locations.map((location) => getRecommendations(companyId, location.id, now)))
  ).flat();

  return {
    revenue: money(revenue),
    profit: money(profit),
    receipts: receipts.filter((receipt) => receipt.status === 'PAID').length,
    byDay: [...days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([day, row]) => ({ day, revenue: money(row.revenue), profit: money(row.profit) })),
    byCategory: [...categories.values()]
      .sort((left, right) => right.revenue.comparedTo(left.revenue))
      .map((row) => ({
        nameRu: row.nameRu,
        nameKk: row.nameKk,
        revenue: money(row.revenue),
        profit: money(row.revenue.minus(row.cost)),
      })),
    abc,
    turnover,
    staleDays: stale,
    recommendations,
  };
}

/** Заявка дошла до магазина: она даёт оборот поставщика. */
const TURNOVER_STATUSES: OrderStatus[] = [
  'SHIPPED',
  'DELIVERED',
  'ACCEPTED_BY_STORE',
  'ACCEPTED_WITH_DISCREPANCY',
  'AWAITING_PAYMENT',
  'OVERDUE',
  'PAID',
  'CLOSED',
  'DISPUTE',
];
/** Выполненная — доставлена и дальше; невыполненная — отклонена или отменена. */
const FULFILLED: OrderStatus[] = TURNOVER_STATUSES.filter((status) => status !== 'SHIPPED');
const NOT_FULFILLED: OrderStatus[] = ['REJECTED', 'CANCELLED'];

export type StoreTurnoverRow = { storeId: string; name: string; orders: number; amount: string };
export type ProductTurnoverRow = {
  nameRu: string;
  nameKk: string;
  quantity: string;
  amount: string;
};

export type SupplierAnalytics = {
  turnover: string;
  orders: number;
  fulfilled: number;
  notFulfilled: number;
  /** Доля выполненных среди завершённых заявок, %; пусто — завершённых ещё нет. */
  fulfillmentShare: string | null;
  byStore: StoreTurnoverRow[];
  topStores: StoreTurnoverRow[];
  byProduct: ProductTurnoverRow[];
};

/**
 * Поставщик: оборот по магазинам и товарам, доля выполненных заявок, топ магазинов.
 * Оборот — заявки, отгруженные магазину; количество — принятое, иначе подтверждённое.
 * TODO(open-question): какие статусы считать оборотом и выполнением, подтверждает заказчик.
 */
export async function supplierAnalytics(
  supplierId: string,
  period: Period,
): Promise<SupplierAnalytics> {
  const orders = await prisma.order.findMany({
    where: {
      supplierId,
      status: { not: 'DRAFT' },
      createdAt: { gte: period.from, lte: period.to },
    },
    include: {
      store: { select: { id: true, name: true } },
      items: {
        include: { offer: { include: { product: { select: { nameRu: true, nameKk: true } } } } },
      },
    },
  });

  let turnover = zero();
  const stores = new Map<string, { name: string; orders: number; amount: Decimal }>();
  const products = new Map<
    string,
    { nameRu: string; nameKk: string; quantity: Decimal; amount: Decimal }
  >();
  let fulfilled = 0;
  let notFulfilled = 0;
  let counted = 0;

  for (const order of orders) {
    if (FULFILLED.includes(order.status)) fulfilled += 1;
    if (NOT_FULFILLED.includes(order.status)) notFulfilled += 1;
    if (!TURNOVER_STATUSES.includes(order.status)) continue;
    counted += 1;
    const amount = new Decimal(order.totalWithVat.toString());
    turnover = turnover.plus(amount);
    const store = stores.get(order.store.id) ?? {
      name: order.store.name,
      orders: 0,
      amount: zero(),
    };
    stores.set(order.store.id, {
      ...store,
      orders: store.orders + 1,
      amount: store.amount.plus(amount),
    });

    for (const item of order.items) {
      const quantity = new Decimal(
        (item.quantityAccepted ?? item.quantityConfirmed ?? item.quantityOrdered).toString(),
      );
      const row = products.get(item.offerId) ?? {
        nameRu: item.offer.product.nameRu,
        nameKk: item.offer.product.nameKk,
        quantity: zero(),
        amount: zero(),
      };
      products.set(item.offerId, {
        ...row,
        quantity: row.quantity.plus(quantity),
        amount: row.amount.plus(quantity.times(item.priceWithVat.toString())),
      });
    }
  }

  const byStore = [...stores.entries()]
    .sort((left, right) => right[1].amount.comparedTo(left[1].amount))
    .map(([storeId, row]) => ({
      storeId,
      name: row.name,
      orders: row.orders,
      amount: money(row.amount),
    }));
  const finished = fulfilled + notFulfilled;

  return {
    turnover: money(turnover),
    orders: counted,
    fulfilled,
    notFulfilled,
    fulfillmentShare: finished > 0 ? ((fulfilled / finished) * 100).toFixed(1) : null,
    byStore,
    topStores: byStore.slice(0, 5),
    byProduct: [...products.values()]
      .sort((left, right) => right.amount.comparedTo(left.amount))
      .map((row) => ({
        nameRu: row.nameRu,
        nameKk: row.nameKk,
        quantity: row.quantity.toFixed(3),
        amount: money(row.amount),
      })),
  };
}
