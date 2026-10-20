import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { orderFixture } from '../helpers/order-fixture';
import { recordSwipe } from '@/lib/feed/swipe';
import { checkout } from '@/lib/orders/checkout';
import { changeStatus } from '@/lib/orders/workflow';
import { checkCredit, resendHeldOrder } from '@/lib/orders/credit';
import { savePaymentTerms } from '@/lib/payments/terms';

const prisma = createTestPrisma();

/** Первая заявка на 580 ₸ (5 × 116) отправлена; лимит поставщика — 1000 ₸. */
async function context(index: number) {
  const base = await orderFixture(prisma, {
    index,
    phones: ['7741', '7742'],
    binBase: 600,
    productBase: 280000,
    upTo: 'SENT',
  });
  expect(
    await savePaymentTerms(base.supplierId, {
      paymentTerms: 'DEFERRED',
      deferralDays: '14',
      creditLimit: '1000',
    }),
  ).toEqual({ status: 'ok' });
  return base;
}

async function orderAgain(base: Awaited<ReturnType<typeof context>>) {
  await recordSwipe(base.storeId, base.locationId, base.offerId, 'LIKE');
  const created = await checkout({
    storeId: base.storeId,
    locationId: base.locationId,
    cityId: base.cityId,
    userId: base.storeUserId,
  });
  if (created.status !== 'created') throw new Error(created.status);
  return created.orders[0]!;
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('кредитный лимит поставщика (раздел 3.6 ТЗ)', () => {
  it('order_over_credit_limit_is_paused_and_not_sent', async () => {
    const base = await context(1);
    expect(await checkCredit(base.storeId, base.supplierId, '0')).toEqual({
      limit: '1000.00',
      debt: '580.00',
      exceeded: false,
    });

    const second = await orderAgain(base);
    expect(second.creditHold).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: second.id } });
    expect(order).toMatchObject({ status: 'DRAFT', creditHold: true });
    // Поставщику уведомление о второй заявке не ушло.
    expect(
      await prisma.notification.count({
        where: { companyId: base.supplierId, orderId: second.id },
      }),
    ).toBe(0);
  });

  it('paused_order_is_resent_after_debt_goes_down', async () => {
    const base = await context(2);
    const second = await orderAgain(base);

    expect(await resendHeldOrder(second.id, base.storeId, base.storeUserId)).toEqual({
      status: 'still_exceeded',
      limit: '1000.00',
      debt: '580.00',
    });

    // Первая заявка отменена — долг ушёл, вторая проходит.
    await changeStatus(base.orderId, base.storeId, base.storeUserId, 'CANCELLED', 'передумали');
    expect(await resendHeldOrder(second.id, base.storeId, base.storeUserId)).toEqual({
      status: 'ok',
    });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: second.id } });
    expect(order).toMatchObject({ status: 'SENT', creditHold: false });
    expect(
      await prisma.notification.count({
        where: { companyId: base.supplierId, orderId: second.id },
      }),
    ).toBe(1);
  });

  it('other_store_cannot_resend_and_limit_is_validated', async () => {
    const base = await context(3);
    const second = await orderAgain(base);
    expect(await resendHeldOrder(second.id, base.supplierId, base.supplierUserId)).toEqual({
      status: 'not_found',
    });

    const bad = (input: Partial<Record<'paymentTerms' | 'deferralDays' | 'creditLimit', string>>) =>
      savePaymentTerms(base.supplierId, {
        paymentTerms: 'DEFERRED',
        deferralDays: '7',
        creditLimit: '',
        ...input,
      });
    expect(await bad({ paymentTerms: 'BARTER' })).toEqual({ status: 'invalid_terms' });
    expect(await bad({ deferralDays: '0' })).toEqual({ status: 'invalid_days' });
    expect(await bad({ creditLimit: '10.123' })).toEqual({ status: 'invalid_limit' });
    // Пустой лимит — ограничения нет, новые заявки уходят сразу.
    expect(await bad({})).toEqual({ status: 'ok' });
    expect((await orderAgain(base)).creditHold).toBe(false);
  });
});
