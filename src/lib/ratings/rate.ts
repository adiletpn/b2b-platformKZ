import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';
import { criteriaFor } from './criteria';

export type RateInput = {
  orderId: string;
  authorCompanyId: string;
  criteria: Record<string, number>;
  comment?: string;
};

export type RateResult =
  | { status: 'ok'; ratingId: string; score: string }
  | { status: 'not_found' }
  | { status: 'order_not_closed'; current: string }
  | { status: 'already_rated' }
  | { status: 'invalid_criteria' };

/**
 * Раздел 3.8 ТЗ: оценка ставится только по закрытой заявке,
 * одна оценка за заявку от каждой стороны.
 */
export async function rateOrder(input: RateInput): Promise<RateResult> {
  const order = await prisma.order.findUnique({ where: { id: input.orderId } });
  if (!order) return { status: 'not_found' };

  const isStore = order.storeId === input.authorCompanyId;
  const isSupplier = order.supplierId === input.authorCompanyId;
  if (!isStore && !isSupplier) return { status: 'not_found' };

  if (order.status !== 'CLOSED') return { status: 'order_not_closed', current: order.status };

  const existing = await prisma.rating.findUnique({
    where: {
      orderId_authorCompanyId: { orderId: order.id, authorCompanyId: input.authorCompanyId },
    },
  });
  if (existing) return { status: 'already_rated' };

  // Магазин оценивает поставщика и наоборот.
  const targetSide = isStore ? 'supplier' : 'store';
  const expected = criteriaFor(targetSide);

  const values = expected.map((key) => input.criteria[key]);
  const invalid =
    values.length === 0 ||
    values.some(
      (value) => typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5,
    );
  if (invalid) return { status: 'invalid_criteria' };

  const score = values
    .reduce((acc, value) => acc.plus(value!), new Decimal(0))
    .div(values.length)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const targetCompanyId = isStore ? order.supplierId : order.storeId;
  const rating = await prisma.rating.create({
    data: {
      orderId: order.id,
      authorCompanyId: input.authorCompanyId,
      targetCompanyId,
      criteria: Object.fromEntries(expected.map((key) => [key, input.criteria[key]])),
      score: score.toFixed(2),
      comment: input.comment?.trim() || null,
    },
  });

  await notify(targetCompanyId, 'rating_received', {
    number: order.number,
    score: score.toFixed(2),
  });

  return { status: 'ok', ratingId: rating.id, score: score.toFixed(2) };
}

/** Ответ на отзыв (раздел 3.8 ТЗ). */
export async function replyToRating(ratingId: string, companyId: string, reply: string) {
  const rating = await prisma.rating.findUnique({ where: { id: ratingId } });
  if (!rating || rating.targetCompanyId !== companyId) return { status: 'not_found' as const };
  if (!reply.trim()) return { status: 'empty_reply' as const };
  if (rating.reply) return { status: 'already_replied' as const };

  await prisma.rating.update({
    where: { id: ratingId },
    data: { reply: reply.trim(), repliedAt: new Date() },
  });
  return { status: 'ok' as const };
}
