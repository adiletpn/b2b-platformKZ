import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { nextDocumentNumber } from '@/lib/orders/numbering';
import { writeAudit } from '@/lib/auth/permissions';

export type ShiftResult =
  | { status: 'ok'; shiftId: string; number: string }
  | { status: 'not_found' }
  | { status: 'already_open' }
  | { status: 'no_open_shift' }
  | { status: 'invalid_amount' };

function parseMoney(value: string) {
  const parsed = new Decimal(value.replace(',', '.'));
  if (!parsed.isFinite() || parsed.isNegative()) throw new Error('invalid_amount');
  // Правило 1: деньги Decimal с двумя знаками.
  return parsed.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Открытие смены на точке (раздел 4.2 ТЗ): одна открытая смена на точку. */
export async function openShift(
  companyId: string,
  userId: string,
  locationId: string,
  openingCash = '0',
): Promise<ShiftResult> {
  // Правило 4: точка должна быть своей.
  const location = await prisma.location.findFirst({ where: { id: locationId, companyId } });
  if (!location) return { status: 'not_found' };

  const open = await prisma.posShift.findFirst({ where: { locationId, status: 'OPEN' } });
  if (open) return { status: 'already_open' };

  let cash: Decimal;
  try {
    cash = parseMoney(openingCash);
  } catch {
    return { status: 'invalid_amount' };
  }

  const shift = await prisma.$transaction(async (tx) => {
    const number = await nextDocumentNumber(tx, companyId, 'shift');
    return tx.posShift.create({
      data: {
        number,
        companyId,
        locationId,
        openingCash: cash.toFixed(2),
        openedById: userId,
      },
    });
  });

  await writeAudit(companyId, userId, 'shift_opened', 'PosShift', shift.id);
  return { status: 'ok', shiftId: shift.id, number: shift.number };
}

type ReceiptWithDetails = {
  status: 'PAID' | 'REFUNDED';
  paymentType: 'CASH' | 'CARD' | 'QR' | 'MIXED';
  total: { toString(): string };
  costTotal: { toString(): string };
  discountTotal: { toString(): string };
  cashAmount: { toString(): string } | null;
  cardAmount: { toString(): string } | null;
  user: { name: string | null; phone: string } | null;
  items: {
    quantity: { toString(): string };
    total: { toString(): string };
    product: { nameRu: string; nameKk: string };
  }[];
};

export type SalesSummary = {
  receipts: number;
  refunds: number;
  total: string;
  byPayment: { CASH: string; CARD: string; QR: string };
  discounts: string;
  cost: string;
  margin: string;
  averageCheck: string;
  byCashier: { name: string; receipts: number; total: string }[];
  topProducts: { nameRu: string; nameKk: string; quantity: string; total: string }[];
};

/** Маскируем телефон кассира, если имя не указано (правило 11). */
function cashierName(user: ReceiptWithDetails['user']) {
  if (!user) return '—';
  return user.name ?? `${user.phone.slice(0, 4)} *** ${user.phone.slice(-2)}`;
}

/**
 * Итоги продаж по чекам: по способам оплаты (смешанная делится на наличные и карту),
 * скидки, средний чек, валовая прибыль, по кассирам и товарам (раздел 4.2 ТЗ).
 */
export function summarize(receipts: ReceiptWithDetails[]): SalesSummary {
  const zero = new Decimal(0);
  const byPayment = { CASH: zero, CARD: zero, QR: zero };
  const cashiers = new Map<string, { receipts: number; total: Decimal }>();
  const products = new Map<
    string,
    { nameRu: string; nameKk: string; quantity: Decimal; total: Decimal }
  >();
  let total = zero;
  let cost = zero;
  let discounts = zero;
  let refunds = 0;

  for (const receipt of receipts) {
    // Возврат уменьшает итог: суммы у него отрицательные.
    const amount = new Decimal(receipt.total.toString());
    total = total.plus(amount);
    cost = cost.plus(receipt.costTotal.toString());
    discounts = discounts.plus(receipt.discountTotal.toString());
    if (receipt.paymentType === 'MIXED') {
      byPayment.CASH = byPayment.CASH.plus(receipt.cashAmount?.toString() ?? '0');
      byPayment.CARD = byPayment.CARD.plus(receipt.cardAmount?.toString() ?? '0');
    } else {
      byPayment[receipt.paymentType] = byPayment[receipt.paymentType].plus(amount);
    }
    if (receipt.status === 'REFUNDED') refunds += 1;

    const name = cashierName(receipt.user);
    const cashier = cashiers.get(name) ?? { receipts: 0, total: zero };
    cashiers.set(name, {
      receipts: cashier.receipts + (receipt.status === 'REFUNDED' ? 0 : 1),
      total: cashier.total.plus(amount),
    });

    for (const item of receipt.items) {
      const key = item.product.nameRu;
      const row = products.get(key) ?? {
        nameRu: item.product.nameRu,
        nameKk: item.product.nameKk,
        quantity: zero,
        total: zero,
      };
      products.set(key, {
        ...row,
        quantity: row.quantity.plus(item.quantity.toString()),
        total: row.total.plus(item.total.toString()),
      });
    }
  }

  const sales = receipts.length - refunds;
  return {
    receipts: sales,
    refunds,
    total: total.toFixed(2),
    byPayment: {
      CASH: byPayment.CASH.toFixed(2),
      CARD: byPayment.CARD.toFixed(2),
      QR: byPayment.QR.toFixed(2),
    },
    discounts: discounts.toFixed(2),
    cost: cost.toFixed(2),
    margin: total.minus(cost).toFixed(2),
    averageCheck: sales > 0 ? total.dividedBy(sales).toFixed(2) : '0.00',
    byCashier: [...cashiers.entries()]
      .map(([name, row]) => ({ name, receipts: row.receipts, total: row.total.toFixed(2) }))
      .sort((a, b) => Number(b.total) - Number(a.total)),
    topProducts: [...products.values()]
      .sort((a, b) => b.total.comparedTo(a.total))
      .slice(0, 10)
      .map((row) => ({
        nameRu: row.nameRu,
        nameKk: row.nameKk,
        quantity: row.quantity.toFixed(3),
        total: row.total.toFixed(2),
      })),
  };
}

const RECEIPT_DETAILS = {
  user: { select: { name: true, phone: true } },
  items: { include: { product: { select: { nameRu: true, nameKk: true } } } },
} as const;

export type ZReport = SalesSummary & {
  shiftId: string;
  number: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: string;
  cashIn: string;
  cashOut: string;
  expectedCash: string;
  closingCash: string | null;
};

/**
 * X-отчёт (смена открыта) и Z-отчёт (смена закрыта) — один расчёт (раздел 4.2 ТЗ).
 * Наличные в ящике: на начало смены + наличные продажи + внесения − изъятия.
 */
export async function getZReport(companyId: string, shiftId: string): Promise<ZReport | null> {
  const shift = await prisma.posShift.findFirst({
    where: { id: shiftId, companyId },
    include: { receipts: { include: RECEIPT_DETAILS }, cashOperations: true },
  });
  if (!shift) return null;

  const summary = summarize(shift.receipts);
  const sumOf = (type: 'CASH_IN' | 'CASH_OUT') =>
    shift.cashOperations
      .filter((operation) => operation.type === type)
      .reduce((total, operation) => total.plus(operation.amount.toString()), new Decimal(0));
  const cashIn = sumOf('CASH_IN');
  const cashOut = sumOf('CASH_OUT');

  return {
    ...summary,
    shiftId: shift.id,
    number: shift.number,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString() ?? null,
    openingCash: shift.openingCash.toFixed(2),
    cashIn: cashIn.toFixed(2),
    cashOut: cashOut.toFixed(2),
    expectedCash: new Decimal(shift.openingCash.toString())
      .plus(summary.byPayment.CASH)
      .plus(cashIn)
      .minus(cashOut)
      .toFixed(2),
    closingCash: shift.closingCash?.toFixed(2) ?? null,
  };
}

/** Отчёт за период по всем сменам компании и точкам, доступным сотруднику. */
export async function getSalesReport(
  companyId: string,
  from: Date,
  to: Date,
  allowedLocationIds: string[] = [],
): Promise<SalesSummary & { from: string; to: string }> {
  const receipts = await prisma.receipt.findMany({
    where: {
      companyId,
      createdAt: { gte: from, lte: to },
      ...(allowedLocationIds.length > 0 ? { locationId: { in: allowedLocationIds } } : {}),
    },
    include: RECEIPT_DETAILS,
  });
  return { ...summarize(receipts), from: from.toISOString(), to: to.toISOString() };
}

export type CashResult =
  | { status: 'ok'; operationId: string }
  | { status: 'no_open_shift' }
  | { status: 'invalid_amount' }
  | { status: 'reason_required' }
  | { status: 'not_enough_cash'; available: string };

/** Внесение и изъятие наличных (раздел 4.2 ТЗ): с причиной, изъять больше, чем в ящике, нельзя. */
export async function cashOperation(
  companyId: string,
  userId: string,
  locationId: string,
  input: { type: 'CASH_IN' | 'CASH_OUT'; amount: string; reason: string },
): Promise<CashResult> {
  const shift = await getOpenShift(companyId, locationId);
  if (!shift) return { status: 'no_open_shift' };

  let amount: Decimal;
  try {
    amount = parseMoney(input.amount);
  } catch {
    return { status: 'invalid_amount' };
  }
  if (amount.isZero()) return { status: 'invalid_amount' };
  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 200) return { status: 'reason_required' };

  if (input.type === 'CASH_OUT') {
    const report = await getZReport(companyId, shift.id);
    if (report && amount.greaterThan(report.expectedCash)) {
      return { status: 'not_enough_cash', available: report.expectedCash };
    }
  }

  const operation = await prisma.cashOperation.create({
    data: {
      shiftId: shift.id,
      companyId,
      type: input.type,
      amount: amount.toFixed(2),
      reason,
      userId,
    },
  });
  await writeAudit(
    companyId,
    userId,
    input.type === 'CASH_IN' ? 'cash_in' : 'cash_out',
    'CashOperation',
    operation.id,
  );
  return { status: 'ok', operationId: operation.id };
}

/** Закрытие смены: Z-отчёт снимается на момент закрытия. */
export async function closeShift(
  companyId: string,
  userId: string,
  shiftId: string,
  closingCash = '0',
): Promise<ShiftResult> {
  const shift = await prisma.posShift.findFirst({
    where: { id: shiftId, companyId, status: 'OPEN' },
  });
  if (!shift) return { status: 'no_open_shift' };

  let cash: Decimal;
  try {
    cash = parseMoney(closingCash);
  } catch {
    return { status: 'invalid_amount' };
  }

  await prisma.posShift.update({
    where: { id: shift.id },
    data: { status: 'CLOSED', closedAt: new Date(), closingCash: cash.toFixed(2) },
  });

  await writeAudit(companyId, userId, 'shift_closed', 'PosShift', shift.id);
  return { status: 'ok', shiftId: shift.id, number: shift.number };
}

export async function getOpenShift(companyId: string, locationId: string) {
  return prisma.posShift.findFirst({ where: { companyId, locationId, status: 'OPEN' } });
}
