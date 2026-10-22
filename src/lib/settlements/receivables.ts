import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';

/** Заявка считается просроченной, если срок оплаты прошёл, а оплаты нет. */
export function isOverdue(dueDate: Date | null, now = new Date()) {
  return dueDate !== null && dueDate < now;
}

export function daysOverdue(dueDate: Date | null, now = new Date()) {
  if (!isOverdue(dueDate, now)) return 0;
  return Math.floor((now.getTime() - dueDate!.getTime()) / 86_400_000);
}

export type ReceivableRow = {
  orderId: string;
  orderNumber: string;
  storeId: string;
  storeName: string;
  amount: string;
  dueDate: string | null;
  daysOverdue: number;
};

export type Receivables = {
  rows: ReceivableRow[];
  total: string;
  overdueTotal: string;
};

/** Отчёт «Дебиторка» поставщика: кто, сколько и на сколько дней просрочил (раздел 3.6 ТЗ). */
export async function getReceivables(supplierId: string, now = new Date()): Promise<Receivables> {
  const orders = await prisma.order.findMany({
    where: { supplierId, status: { in: ['AWAITING_PAYMENT', 'OVERDUE'] } },
    include: { store: { select: { id: true, name: true } } },
    orderBy: { paymentDueDate: 'asc' },
  });

  let total = new Decimal(0);
  let overdueTotal = new Decimal(0);

  const rows = orders.map((order) => {
    const amount = new Decimal(order.totalWithVat.toString());
    total = total.plus(amount);
    const overdue = daysOverdue(order.paymentDueDate, now);
    if (overdue > 0) overdueTotal = overdueTotal.plus(amount);

    return {
      orderId: order.id,
      orderNumber: order.number,
      storeId: order.store.id,
      storeName: order.store.name,
      amount: amount.toFixed(2),
      dueDate: order.paymentDueDate?.toISOString().slice(0, 10) ?? null,
      daysOverdue: overdue,
    };
  });

  return { rows, total: total.toFixed(2), overdueTotal: overdueTotal.toFixed(2) };
}

export type StoreDebt = {
  storeId: string;
  storeName: string;
  city: string | null;
  debt: string;
  overdue: string;
  /** Самая долгая просрочка по заявкам магазина, дней. */
  maxDaysOverdue: number;
  /** Доля кредитного лимита поставщика, занятая долгом, %; null — лимит не задан. */
  limitUsedPercent: number | null;
};

/**
 * Дебиторка по магазинам (макет D06): долг, просрочка, дни и занятый кредитный лимит.
 * Лимит один на магазин из условий поставщика (раздел 3.6 ТЗ).
 */
export async function getStoreDebts(supplierId: string, now = new Date()): Promise<StoreDebt[]> {
  const { rows } = await getReceivables(supplierId, now);
  const supplier = await prisma.company.findUniqueOrThrow({
    where: { id: supplierId },
    select: { creditLimit: true },
  });
  const limit = supplier.creditLimit ? new Decimal(supplier.creditLimit.toString()) : null;

  const byStore = new Map<
    string,
    { name: string; debt: Decimal; overdue: Decimal; days: number }
  >();
  for (const row of rows) {
    const entry = byStore.get(row.storeId) ?? {
      name: row.storeName,
      debt: new Decimal(0),
      overdue: new Decimal(0),
      days: 0,
    };
    entry.debt = entry.debt.plus(row.amount);
    if (row.daysOverdue > 0) entry.overdue = entry.overdue.plus(row.amount);
    entry.days = Math.max(entry.days, row.daysOverdue);
    byStore.set(row.storeId, entry);
  }

  const locations = await prisma.location.findMany({
    where: { companyId: { in: [...byStore.keys()] } },
    include: { city: { select: { nameRu: true } } },
    orderBy: { createdAt: 'asc' },
  });

  return [...byStore.entries()]
    .map(([storeId, entry]) => ({
      storeId,
      storeName: entry.name,
      city: locations.find((location) => location.companyId === storeId)?.city.nameRu ?? null,
      debt: entry.debt.toFixed(2),
      overdue: entry.overdue.toFixed(2),
      maxDaysOverdue: entry.days,
      limitUsedPercent:
        limit && limit.gt(0)
          ? entry.debt.div(limit).times(100).toDecimalPlaces(0).toNumber()
          : null,
    }))
    .sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue || Number(b.debt) - Number(a.debt));
}

/** Оплачено поставщику с начала месяца (третья плашка D06). */
export async function paidThisMonth(supplierId: string, now = new Date()) {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const payments = await prisma.payment.findMany({
    where: { order: { supplierId }, status: 'PAID', paidAt: { gte: from } },
    select: { amount: true, orderId: true },
  });
  const total = payments.reduce(
    (sum, payment) => sum.plus(payment.amount.toString()),
    new Decimal(0),
  );
  return {
    total: total.toFixed(2),
    orders: new Set(payments.map((payment) => payment.orderId)).size,
  };
}

/** Помечает просроченные заявки и шлёт напоминания обеим сторонам (раздел 3.6 ТЗ). */
export async function markOverdueOrders(now = new Date()) {
  const due = await prisma.order.findMany({
    where: { status: 'AWAITING_PAYMENT', paymentDueDate: { lt: now } },
    select: { id: true, status: true },
  });

  for (const order of due) {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: 'OVERDUE' } });
      await tx.orderStatusLog.create({
        data: { orderId: order.id, fromStatus: order.status, toStatus: 'OVERDUE' },
      });
    });
  }

  return { marked: due.length };
}

export type SettlementRow = {
  date: string;
  document: string;
  debit: string;
  credit: string;
};

/** Акт сверки взаиморасчётов за период (раздел 3.6 ТЗ). */
export async function getSettlement(supplierId: string, storeId: string, from: Date, to: Date) {
  const [orders, payments] = await Promise.all([
    prisma.order.findMany({
      where: {
        supplierId,
        storeId,
        createdAt: { gte: from, lte: to },
        status: { notIn: ['DRAFT', 'CANCELLED', 'REJECTED'] },
      },
      include: { documents: { where: { type: 'WAYBILL' }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payment.findMany({
      where: { order: { supplierId, storeId }, paidAt: { gte: from, lte: to } },
      include: { order: { select: { number: true } } },
      orderBy: { paidAt: 'asc' },
    }),
  ]);

  const rows: SettlementRow[] = [];
  let debit = new Decimal(0);
  let credit = new Decimal(0);

  for (const order of orders) {
    const amount = new Decimal(order.totalWithVat.toString());
    debit = debit.plus(amount);
    rows.push({
      date: order.createdAt.toISOString().slice(0, 10),
      document: order.documents[0]?.number ?? order.number,
      debit: amount.toFixed(2),
      credit: '0.00',
    });
  }

  for (const payment of payments) {
    const amount = new Decimal(payment.amount.toString());
    credit = credit.plus(amount);
    rows.push({
      date: payment.paidAt.toISOString().slice(0, 10),
      document: payment.reference ?? payment.order.number,
      debit: '0.00',
      credit: amount.toFixed(2),
    });
  }

  rows.sort((left, right) => left.date.localeCompare(right.date));

  return {
    rows,
    debit: debit.toFixed(2),
    credit: credit.toFixed(2),
    // Положительный остаток — магазин должен поставщику.
    balance: debit.minus(credit).toFixed(2),
  };
}
