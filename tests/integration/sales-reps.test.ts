import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { orderFixture } from '../helpers/order-fixture';
import { acceptPendingInvitations, inviteEmployee } from '@/lib/employees/invitations';
import { hasPermission } from '@/lib/auth/permissions';
import { addVisit, assignStore, eligibleStores, listReps, repStores } from '@/lib/reps/reps';

const prisma = createTestPrisma();

/** Сотрудник поставщика с системной ролью «Торговый представитель», через приглашение. */
async function inviteRep(supplierId: string, ownerId: string, phone: string) {
  const invited = await inviteEmployee(supplierId, ownerId, phone, 'SALES_REP');
  if (invited.status !== 'ok') throw new Error(invited.status);
  const user = await prisma.user.create({ data: { phone } });
  await acceptPendingInvitations(user.id, phone);
  return prisma.membership.findFirstOrThrow({ where: { userId: user.id, companyId: supplierId } });
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('торговые представители (этап 3)', () => {
  it('rep_sees_only_assigned_stores_and_marks_visits', async () => {
    const base = await orderFixture(prisma, {
      index: 1,
      phones: ['7793', '7794'],
      binBase: 520,
      productBase: 320000,
    });
    const foreign = await orderFixture(prisma, {
      index: 2,
      phones: ['7793', '7794'],
      binBase: 520,
      productBase: 320000,
    });
    const rep = await inviteRep(base.supplierId, base.supplierUserId, '+77795000001');
    const second = await inviteRep(base.supplierId, base.supplierUserId, '+77795000002');

    // Права представителя — из справочника ролей в БД (правило 5): заявок он не видит.
    const access = {
      userId: rep.userId,
      companyId: base.supplierId,
      membershipId: rep.id,
      roleCode: rep.role,
      allowedLocationIds: [],
      orderLimit: null,
    };
    expect(await hasPermission(access, 'SALES_REPS', 'VIEW')).toBe(true);
    expect(await hasPermission(access, 'SALES_REPS', 'UPDATE')).toBe(false);
    expect(await hasPermission(access, 'SWIPE_ORDERS', 'VIEW')).toBe(false);

    expect((await listReps(base.supplierId)).map((row) => row.membershipId).sort()).toEqual(
      [rep.id, second.id].sort(),
    );
    expect(await eligibleStores(base.supplierId)).toEqual([
      expect.objectContaining({ storeId: base.storeId }),
    ]);

    // Чужой магазин (не заказывал у этого поставщика) закрепить нельзя.
    expect(
      await assignStore(base.supplierId, base.supplierUserId, rep.id, foreign.storeId),
    ).toEqual({ status: 'not_customer' });
    expect(await assignStore(base.supplierId, base.supplierUserId, rep.id, base.storeId)).toEqual({
      status: 'ok',
    });

    const stores = await repStores(base.supplierId, rep.id);
    expect(stores).toHaveLength(1);
    expect(stores[0]!.orders.map((order) => order.id)).toEqual([base.orderId]);
    expect(await repStores(base.supplierId, second.id)).toEqual([]);

    expect(await addVisit(base.supplierId, rep.id, rep.userId, base.storeId, '  ')).toEqual({
      status: 'comment_required',
    });
    expect(
      (await addVisit(base.supplierId, rep.id, rep.userId, base.storeId, 'Обсудили акцию')).status,
    ).toBe('ok');
    // Второй представитель в чужой магазин визит не отметит.
    expect(
      await addVisit(base.supplierId, second.id, second.userId, base.storeId, 'Зашёл'),
    ).toEqual({ status: 'not_found' });
    // И поставщик-конкурент не видит закреплений этого поставщика (правило 4).
    expect(await repStores(foreign.supplierId, rep.id)).toEqual([]);
    expect((await repStores(base.supplierId, rep.id))[0]!.visits).toEqual([
      expect.objectContaining({ comment: 'Обсудили акцию' }),
    ]);
  });
});
