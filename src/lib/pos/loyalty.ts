import Decimal from 'decimal.js';
import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/admin/settings';
import { maskPhone, normalizePhone } from '@/lib/phone';

/**
 * Программа лояльности на кассе (этап 3, раздел 4.2 ТЗ): бонусы по номеру телефона
 * покупателя. Чек начисляет процент бонусами, следующей покупкой можно списать до доли чека.
 * Баланс меняется только движением бонусного счёта в транзакции чека — по образцу правила 3.
 *
 * TODO(open-question): процент начисления и доля списания — значения по умолчанию
 * в настройках платформы; начисление идёт на сумму, оплаченную деньгами; согласие покупателя
 * на обработку номера телефона (закон №94-V) и проводка бонусов в фискальном чеке
 * (как скидка или как оплата) подтверждает заказчик.
 */
export type LoyaltySettings = { earnPercent: Decimal; maxRedeemShare: Decimal };

function percentSetting(value: string, fallback: string) {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() && parsed.greaterThanOrEqualTo(0) && parsed.lessThanOrEqualTo(100)
      ? parsed
      : new Decimal(fallback);
  } catch {
    return new Decimal(fallback);
  }
}

export async function loyaltySettings(): Promise<LoyaltySettings> {
  const [earn, share] = await Promise.all([
    getSetting('loyalty_earn_percent', '5'),
    getSetting('loyalty_max_redeem_share', '50'),
  ]);
  return { earnPercent: percentSetting(earn, '5'), maxRedeemShare: percentSetting(share, '50') };
}

/** Сколько бонусов можно списать с чека на эту сумму: доля чека, вниз до копейки. */
export function maxRedeemFor(total: Decimal, settings: LoyaltySettings) {
  return total.times(settings.maxRedeemShare).div(100).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

/** Начисление с суммы, оплаченной деньгами, вниз до копейки. */
export function earnedFor(paid: Decimal, settings: LoyaltySettings) {
  return paid.times(settings.earnPercent).div(100).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

export type CustomerLookup =
  | { status: 'ok'; phone: string; balance: string; earnPercent: string; maxRedeemShare: string }
  | { status: 'invalid_phone' };

/** Баланс покупателя для кассира. Правило 4: только покупатели своей компании. */
export async function lookupCustomer(companyId: string, rawPhone: string): Promise<CustomerLookup> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return { status: 'invalid_phone' };
  const [customer, settings] = await Promise.all([
    prisma.loyaltyCustomer.findUnique({ where: { companyId_phone: { companyId, phone } } }),
    loyaltySettings(),
  ]);
  return {
    status: 'ok',
    phone: maskPhone(phone),
    balance: customer?.balance.toFixed(2) ?? '0.00',
    earnPercent: settings.earnPercent.toFixed(2),
    maxRedeemShare: settings.maxRedeemShare.toFixed(2),
  };
}

/** Бонусов не хватило: транзакция чека откатывается целиком. */
export class NotEnoughBonusError extends Error {
  constructor(readonly available: string) {
    super('not_enough_bonus');
  }
}

/**
 * Начисление и списание в транзакции чека. Списание — условным обновлением: при двух
 * кассах с одним покупателем баланс не уйдёт в минус.
 */
export async function applyLoyalty(
  tx: Prisma.TransactionClient,
  input: {
    companyId: string;
    receiptId: string;
    phone: string;
    redeem: Decimal;
    earned: Decimal;
  },
) {
  const customer = await tx.loyaltyCustomer.upsert({
    where: { companyId_phone: { companyId: input.companyId, phone: input.phone } },
    update: {},
    create: { companyId: input.companyId, phone: input.phone },
  });

  if (input.redeem.greaterThan(0)) {
    const updated = await tx.loyaltyCustomer.updateMany({
      where: { id: customer.id, balance: { gte: input.redeem.toFixed(2) } },
      data: { balance: { decrement: input.redeem.toFixed(2) } },
    });
    if (updated.count === 0) throw new NotEnoughBonusError(customer.balance.toFixed(2));
    await tx.loyaltyMovement.create({
      data: {
        customerId: customer.id,
        receiptId: input.receiptId,
        type: 'REDEEM',
        amount: input.redeem.negated().toFixed(2),
      },
    });
  }
  if (input.earned.greaterThan(0)) {
    await tx.loyaltyCustomer.update({
      where: { id: customer.id },
      data: { balance: { increment: input.earned.toFixed(2) } },
    });
    await tx.loyaltyMovement.create({
      data: {
        customerId: customer.id,
        receiptId: input.receiptId,
        type: 'EARN',
        amount: input.earned.toFixed(2),
      },
    });
  }

  // Правило 11: телефон покупателя в логе только маской.
  console.info(
    `[loyalty] ${maskPhone(input.phone)}: списано ${input.redeem.toFixed(2)}, ` +
      `начислено ${input.earned.toFixed(2)}`,
  );
  return customer.id;
}

/**
 * Возврат чека откатывает и начисление, и списание: списанные бонусы возвращаются
 * покупателю, начисленные снимаются. Если начисленное уже потрачено, баланс уходит
 * в минус и гасится следующими покупками — TODO(open-question): правило для такого случая.
 */
export async function revertLoyalty(
  tx: Prisma.TransactionClient,
  original: { loyaltyCustomerId: string | null; bonusRedeemed: Decimal; bonusEarned: Decimal },
  refundReceiptId: string,
) {
  if (!original.loyaltyCustomerId) return;
  const change = original.bonusRedeemed.minus(original.bonusEarned);
  await tx.loyaltyCustomer.update({
    where: { id: original.loyaltyCustomerId },
    data: { balance: { increment: change.toFixed(2) } },
  });
  const rows = [
    { type: 'REDEEM_REVERSAL' as const, amount: original.bonusRedeemed },
    { type: 'EARN_REVERSAL' as const, amount: original.bonusEarned.negated() },
  ].filter((row) => !row.amount.isZero());
  for (const row of rows) {
    await tx.loyaltyMovement.create({
      data: {
        customerId: original.loyaltyCustomerId,
        receiptId: refundReceiptId,
        type: row.type,
        amount: row.amount.toFixed(2),
      },
    });
  }
}
