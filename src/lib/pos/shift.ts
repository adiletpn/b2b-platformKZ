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

export type ZReport = {
  shiftId: string;
  number: string;
  openedAt: string;
  closedAt: string | null;
  receipts: number;
  refunds: number;
  total: string;
  byPayment: { CASH: string; CARD: string; QR: string };
  cost: string;
  margin: string;
  openingCash: string;
  expectedCash: string;
};

/** Z-отчёт: итоги смены по типам оплаты (раздел 4.2 ТЗ). */
export async function getZReport(companyId: string, shiftId: string): Promise<ZReport | null> {
  const shift = await prisma.posShift.findFirst({
    where: { id: shiftId, companyId },
    include: { receipts: true },
  });
  if (!shift) return null;

  const zero = new Decimal(0);
  const byPayment = { CASH: zero, CARD: zero, QR: zero };
  let total = zero;
  let cost = zero;
  let refunds = 0;

  for (const receipt of shift.receipts) {
    // Возврат уменьшает итог смены: сумма у него отрицательная.
    const amount = new Decimal(receipt.total.toString());
    total = total.plus(amount);
    cost = cost.plus(receipt.costTotal.toString());
    byPayment[receipt.paymentType] = byPayment[receipt.paymentType].plus(amount);
    if (receipt.status === 'REFUNDED') refunds += 1;
  }

  return {
    shiftId: shift.id,
    number: shift.number,
    openedAt: shift.openedAt.toISOString(),
    closedAt: shift.closedAt?.toISOString() ?? null,
    receipts: shift.receipts.length - refunds,
    refunds,
    total: total.toFixed(2),
    byPayment: {
      CASH: byPayment.CASH.toFixed(2),
      CARD: byPayment.CARD.toFixed(2),
      QR: byPayment.QR.toFixed(2),
    },
    cost: cost.toFixed(2),
    margin: total.minus(cost).toFixed(2),
    openingCash: shift.openingCash.toFixed(2),
    expectedCash: new Decimal(shift.openingCash.toString()).plus(byPayment.CASH).toFixed(2),
  };
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
