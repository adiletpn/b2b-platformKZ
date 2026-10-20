import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { notify } from '@/mocks/notifications';
import { writeAdminAudit } from '@/lib/admin/session';
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

export const DISPUTE_REASON_MIN = 10;

/**
 * Оспаривание отзыва (раздел 3.8 ТЗ): компания, о которой отзыв, один раз отправляет
 * его модератору с причиной. Срок разбора и права модератора — TODO(open-question).
 */
export async function disputeRating(ratingId: string, companyId: string, rawReason: string) {
  const rating = await prisma.rating.findUnique({ where: { id: ratingId } });
  // Правило 4: оспорить можно только отзыв о своей компании.
  if (!rating || rating.targetCompanyId !== companyId) return { status: 'not_found' as const };
  if (rating.disputedAt) return { status: 'already_disputed' as const };
  const reason = rawReason.trim();
  if (reason.length < DISPUTE_REASON_MIN) return { status: 'reason_required' as const };

  await prisma.rating.update({
    where: { id: ratingId },
    data: { disputeReason: reason.slice(0, 1000), disputedAt: new Date() },
  });
  return { status: 'ok' as const };
}

export type DisputedRatingRow = {
  id: string;
  authorName: string;
  targetName: string;
  orderNumber: string;
  score: string;
  comment: string | null;
  reason: string;
  disputedAt: string;
};

/** Очередь модератора: оспоренные и ещё не разобранные отзывы. */
export async function listDisputedRatings(): Promise<DisputedRatingRow[]> {
  const rows = await prisma.rating.findMany({
    where: { disputedAt: { not: null }, disputeResolvedAt: null },
    include: {
      authorCompany: { select: { name: true } },
      targetCompany: { select: { name: true } },
      order: { select: { number: true } },
    },
    orderBy: { disputedAt: 'asc' },
    take: 50,
  });
  return rows.map((row) => ({
    id: row.id,
    authorName: row.authorCompany.name,
    targetName: row.targetCompany.name,
    orderNumber: row.order.number,
    score: row.score.toFixed(2),
    comment: row.comment,
    reason: row.disputeReason ?? '',
    disputedAt: row.disputedAt!.toISOString(),
  }));
}

/** Решение модератора: скрыть отзыв или оставить, с комментарием в журнал. */
export async function resolveRatingDispute(
  adminId: string,
  ratingId: string,
  decision: 'hide' | 'keep',
  rawResolution: string,
) {
  const resolution = rawResolution.trim();
  if (resolution.length < 3) return { status: 'comment_required' as const };
  const rating = await prisma.rating.findFirst({
    where: { id: ratingId, disputedAt: { not: null }, disputeResolvedAt: null },
  });
  if (!rating) return { status: 'not_found' as const };

  const now = new Date();
  await prisma.rating.update({
    where: { id: ratingId },
    data: {
      disputeResolution: resolution,
      disputeResolvedAt: now,
      hiddenAt: decision === 'hide' ? now : null,
    },
  });
  await writeAdminAudit(adminId, decision === 'hide' ? 'rating_hidden' : 'rating_kept', {
    entity: 'Rating',
    entityId: ratingId,
    reason: resolution,
  });
  await notify(rating.targetCompanyId, 'rating_dispute_resolved', {});
  return { status: 'ok' as const };
}
