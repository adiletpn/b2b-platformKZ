import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { recordSwipe } from '@/lib/feed/swipe';
import { checkout } from '@/lib/orders/checkout';
import { changeStatus, confirmOrder } from '@/lib/orders/workflow';
import { createWaybillAndInvoice } from '@/lib/documents/create';
import { acceptDelivery } from '@/lib/acceptance/accept';
import { recordPayment } from '@/lib/payments/record';
import {
  disputeRating,
  listDisputedRatings,
  rateOrder,
  replyToRating,
  resolveRatingDispute,
} from '@/lib/ratings/rate';
import { chatResponseMinutes, getCompanyRating } from '@/lib/ratings/metrics';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

const SUPPLIER_CRITERIA = { quality: 5, matching: 4, politeness: 5, packaging: 4 };
const STORE_CRITERIA = { acceptance: 5, communication: 4 };

/** Заявка, доведённая до нужного статуса через обычный путь, без правок в БД. */
async function scenario(index: number, options: { close?: boolean; payDelayDays?: number } = {}) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7740${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7741${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(300 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(301 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 15' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(110000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 5 }),
      ]),
    ),
  );

  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: store.companyId },
  });
  const offer = await prisma.supplierOffer.findFirstOrThrow({
    where: { supplierId: supplier.companyId },
  });
  await recordSwipe(store.companyId, location.id, offer.id, 'LIKE');

  const created = await checkout({
    storeId: store.companyId,
    locationId: location.id,
    cityId: taraz.id,
    userId: storeUser.id,
  });
  if (created.status !== 'created') throw new Error(created.status);
  const orderId = created.orders[0]!.id;

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  await confirmOrder(
    orderId,
    supplier.companyId,
    supplierUser.id,
    order.items.map((item) => ({
      orderItemId: item.id,
      quantityConfirmed: item.quantityOrdered.toFixed(3),
    })),
  );
  await createWaybillAndInvoice(orderId, supplier.companyId);
  for (const status of ['PICKING', 'SHIPPED', 'DELIVERED'] as const) {
    await changeStatus(orderId, supplier.companyId, supplierUser.id, status);
  }
  await acceptDelivery(
    orderId,
    store.companyId,
    storeUser.id,
    order.items.map((item) => ({
      orderItemId: item.id,
      quantityAccepted: item.quantityOrdered.toFixed(3),
    })),
  );

  if (options.close) {
    await changeStatus(orderId, store.companyId, storeUser.id, 'AWAITING_PAYMENT');
    const toPay = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    const paidAt = new Date();
    paidAt.setDate(paidAt.getDate() + (options.payDelayDays ?? 0));
    await recordPayment({
      orderId,
      storeId: store.companyId,
      userId: storeUser.id,
      amount: toPay.totalWithVat.toFixed(2),
      method: 'ON_DELIVERY',
      paidAt: paidAt.toISOString().slice(0, 10),
    });
    await changeStatus(orderId, store.companyId, storeUser.id, 'CLOSED');
  }

  return {
    orderId,
    supplierId: supplier.companyId,
    storeId: store.companyId,
    supplierUserId: supplierUser.id,
    storeUserId: storeUser.id,
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.rating.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('оценка заявки', () => {
  it('rating_is_possible_only_for_closed_order', async () => {
    const context = await scenario(1);

    const result = await rateOrder({
      orderId: context.orderId,
      authorCompanyId: context.storeId,
      criteria: SUPPLIER_CRITERIA,
    });

    expect(result.status).toBe('order_not_closed');
    expect(await prisma.rating.count()).toBe(0);
  });

  it('rating_can_be_given_once_by_each_side', async () => {
    const context = await scenario(2, { close: true });

    const fromStore = await rateOrder({
      orderId: context.orderId,
      authorCompanyId: context.storeId,
      criteria: SUPPLIER_CRITERIA,
      comment: 'привезли вовремя',
    });
    const fromSupplier = await rateOrder({
      orderId: context.orderId,
      authorCompanyId: context.supplierId,
      criteria: STORE_CRITERIA,
    });

    expect(fromStore.status).toBe('ok');
    expect(fromSupplier.status).toBe('ok');
    // Критерий этапа 1 ТЗ: только один раз от каждой стороны.
    expect(
      await rateOrder({
        orderId: context.orderId,
        authorCompanyId: context.storeId,
        criteria: SUPPLIER_CRITERIA,
      }),
    ).toEqual({ status: 'already_rated' });

    expect(await prisma.rating.count({ where: { orderId: context.orderId } })).toBe(2);
  });

  it('rating_score_is_average_of_criteria', async () => {
    const context = await scenario(3, { close: true });

    const result = await rateOrder({
      orderId: context.orderId,
      authorCompanyId: context.storeId,
      criteria: { quality: 5, matching: 4, politeness: 5, packaging: 4 },
    });

    expect(result).toMatchObject({ status: 'ok', score: '4.50' });
  });

  it('rating_rejects_values_outside_one_to_five', async () => {
    const context = await scenario(4, { close: true });

    expect(
      await rateOrder({
        orderId: context.orderId,
        authorCompanyId: context.storeId,
        criteria: { quality: 6, matching: 4, politeness: 5, packaging: 4 },
      }),
    ).toEqual({ status: 'invalid_criteria' });

    // Неполный набор критериев тоже не принимается.
    expect(
      await rateOrder({
        orderId: context.orderId,
        authorCompanyId: context.storeId,
        criteria: { quality: 5 },
      }),
    ).toEqual({ status: 'invalid_criteria' });
  });

  it('rating_of_foreign_order_is_not_possible', async () => {
    const context = await scenario(5, { close: true });
    const stranger = await scenario(6, { close: true });

    expect(
      await rateOrder({
        orderId: context.orderId,
        authorCompanyId: stranger.storeId,
        criteria: SUPPLIER_CRITERIA,
      }),
    ).toEqual({ status: 'not_found' });
  });

  it('target_company_is_notified_about_rating', async () => {
    const context = await scenario(7, { close: true });
    await prisma.notification.deleteMany();

    await rateOrder({
      orderId: context.orderId,
      authorCompanyId: context.storeId,
      criteria: SUPPLIER_CRITERIA,
    });

    const notification = await prisma.notification.findFirstOrThrow({
      where: { companyId: context.supplierId },
    });
    expect(notification.event).toBe('rating_received');
  });

  it('company_can_reply_to_review_once', async () => {
    const context = await scenario(8, { close: true });
    const rating = await rateOrder({
      orderId: context.orderId,
      authorCompanyId: context.storeId,
      criteria: SUPPLIER_CRITERIA,
      comment: 'были вопросы по упаковке',
    });
    if (rating.status !== 'ok') throw new Error(rating.status);

    expect(await replyToRating(rating.ratingId, context.supplierId, 'учтём, спасибо')).toEqual({
      status: 'ok',
    });
    expect(await replyToRating(rating.ratingId, context.supplierId, 'ещё раз')).toEqual({
      status: 'already_replied',
    });
    // Отвечать может только та компания, которую оценили.
    expect(await replyToRating(rating.ratingId, context.storeId, 'чужой ответ')).toEqual({
      status: 'not_found',
    });
  });
});

describe('рейтинг компании', () => {
  it('supplier_rating_combines_manual_score_and_auto_metrics', async () => {
    const context = await scenario(9, { close: true });
    await rateOrder({
      orderId: context.orderId,
      authorCompanyId: context.storeId,
      criteria: { quality: 5, matching: 5, politeness: 5, packaging: 5 },
    });

    const rating = await getCompanyRating(context.supplierId);

    expect(rating.manualScore).toBe('5.00');
    expect(rating.ratingsCount).toBe(1);
    expect(rating.supplier).not.toBeNull();
    // Заявка выполнена полностью и без расхождений.
    expect(rating.supplier!.fulfilledShare).toBe('100.00');
    expect(rating.supplier!.discrepancyShare).toBe('0.00');
  });

  it('new_company_is_marked_as_having_few_ratings', async () => {
    const context = await scenario(10, { close: true });
    const rating = await getCompanyRating(context.supplierId);

    expect(rating.ratingsCount).toBe(0);
    expect(rating.fewRatings).toBe(true);
    expect(rating.manualScore).toBeNull();
  });

  it('store_payment_discipline_is_on_time_when_paid_immediately', async () => {
    const context = await scenario(11, { close: true });
    const rating = await getCompanyRating(context.storeId);

    expect(rating.store).not.toBeNull();
    expect(rating.store!.discipline).toBe('on_time');
    expect(rating.store!.cancelledShare).toBe('0.00');
  });

  it('store_payment_discipline_degrades_with_delay', async () => {
    const context = await scenario(12, { close: true, payDelayDays: 10 });
    const rating = await getCompanyRating(context.storeId);

    // Раздел 3.8 ТЗ: просрочка больше недели — «частые просрочки».
    expect(rating.store!.discipline).toBe('frequent_delays');
    expect(Number(rating.store!.averagePaymentDelayDays)).toBeGreaterThan(7);
  });

  it('ratings_older_than_twelve_months_are_not_counted', async () => {
    const context = await scenario(13, { close: true });
    const rating = await rateOrder({
      orderId: context.orderId,
      authorCompanyId: context.storeId,
      criteria: SUPPLIER_CRITERIA,
    });
    if (rating.status !== 'ok') throw new Error(rating.status);

    const old = new Date();
    old.setMonth(old.getMonth() - 13);
    await prisma.rating.update({ where: { id: rating.ratingId }, data: { createdAt: old } });

    const computed = await getCompanyRating(context.supplierId);
    expect(computed.ratingsCount).toBe(0);
    expect(computed.manualScore).toBeNull();
  });
  it('chat_response_speed_is_median_wait_for_supplier_reply', async () => {
    const context = await scenario(40);
    const chat = await prisma.chat.create({
      data: { storeId: context.storeId, supplierId: context.supplierId },
    });
    const at = (minutes: number) => new Date(Date.now() - 86_400_000 + minutes * 60_000);
    const say = (companyId: string, minutes: number) =>
      prisma.message.create({
        data: { chatId: chat.id, authorCompanyId: companyId, text: '…', createdAt: at(minutes) },
      });
    // Ожидания: 10 минут (от первого из двух вопросов), 30 минут, последний вопрос без ответа.
    await say(context.storeId, 0);
    await say(context.storeId, 5);
    await say(context.supplierId, 10);
    await say(context.storeId, 20);
    await say(context.supplierId, 50);
    await say(context.supplierId, 55);
    await say(context.storeId, 60);

    expect(await chatResponseMinutes(context.supplierId, at(-1))).toBe('20');
    expect(await chatResponseMinutes(context.storeId, at(-1))).toBeNull();
  });
  it('disputed_review_hidden_by_moderator_leaves_score', async () => {
    const context = await scenario(9, { close: true });
    const rating = await rateOrder({
      orderId: context.orderId,
      authorCompanyId: context.storeId,
      criteria: { quality: 1, matching: 1, politeness: 1, packaging: 1 },
      comment: 'несправедливый отзыв',
    });
    if (rating.status !== 'ok') throw new Error(rating.status);
    expect((await getCompanyRating(context.supplierId)).manualScore).toBe('1.00');

    // Оспорить может только та компания, о которой отзыв, и с причиной.
    expect(await disputeRating(rating.ratingId, context.storeId, 'хочу скрыть отзыв')).toEqual({
      status: 'not_found',
    });
    expect(await disputeRating(rating.ratingId, context.supplierId, 'коротко')).toEqual({
      status: 'reason_required',
    });
    expect(
      await disputeRating(rating.ratingId, context.supplierId, 'товар был доставлен вовремя'),
    ).toEqual({ status: 'ok' });
    expect(
      await disputeRating(rating.ratingId, context.supplierId, 'товар был доставлен вовремя'),
    ).toEqual({ status: 'already_disputed' });
    expect((await listDisputedRatings()).map((row) => row.id)).toEqual([rating.ratingId]);

    const admin = await prisma.adminUser.findFirstOrThrow();
    expect(await resolveRatingDispute(admin.id, rating.ratingId, 'hide', '')).toEqual({
      status: 'comment_required',
    });
    expect(
      await resolveRatingDispute(admin.id, rating.ratingId, 'hide', 'отзыв без оснований'),
    ).toEqual({ status: 'ok' });
    expect(await listDisputedRatings()).toEqual([]);
    expect((await getCompanyRating(context.supplierId)).manualScore).toBeNull();
  });
});
