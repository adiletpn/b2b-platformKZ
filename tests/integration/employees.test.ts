import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { registerCompany } from '@/lib/registration/register-company';
import {
  acceptPendingInvitations,
  blockEmployee,
  inviteEmployee,
  unblockEmployee,
} from '@/lib/employees/invitations';
import { hasPermission } from '@/lib/auth/permissions';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function createStore(index: number) {
  const user = await prisma.user.create({
    data: { phone: `+7720${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const result = await registerCompany({
    userId: user.id,
    bin: testPoolBin(250 + index),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 12' },
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);
  return { companyId: result.companyId, ownerId: user.id };
}

/** Контекст доступа без HTTP-слоя: проверяем матрицу прав напрямую. */
async function accessFor(userId: string, companyId: string) {
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { userId_companyId: { userId, companyId } },
  });
  return {
    userId,
    companyId,
    membershipId: membership.id,
    roleCode: membership.role,
    allowedLocationIds: membership.allowedLocationIds,
    orderLimit: membership.orderLimit?.toFixed(2) ?? null,
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.invitation.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.role.deleteMany({ where: { companyId: { not: null } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('матрица прав', () => {
  it('owner_has_every_permission', async () => {
    const store = await createStore(1);
    const access = await accessFor(store.ownerId, store.companyId);

    for (const section of [
      'SWIPE_ORDERS',
      'ACCEPTANCE',
      'STOCK',
      'EMPLOYEES_REQUISITES',
    ] as const) {
      expect(await hasPermission(access, section, 'VIEW'), section).toBe(true);
    }
    expect(await hasPermission(access, 'PURCHASE_PRICES', 'VIEW')).toBe(true);
  });

  it('cashier_cannot_open_purchase_prices_orders_and_exports', async () => {
    const store = await createStore(2);
    const invited = await inviteEmployee(store.companyId, store.ownerId, '+77201111111', 'CASHIER');
    expect(invited.status).toBe('ok');

    const cashier = await prisma.user.create({ data: { phone: '+77201111111' } });
    await acceptPendingInvitations(cashier.id, '+77201111111');
    const access = await accessFor(cashier.id, store.companyId);

    // Критерий этапа 1 ТЗ: кассир не видит закупочные цены, заявки и выгрузки.
    expect(await hasPermission(access, 'PURCHASE_PRICES', 'VIEW')).toBe(false);
    expect(await hasPermission(access, 'SWIPE_ORDERS', 'VIEW')).toBe(false);
    expect(await hasPermission(access, 'SWIPE_ORDERS', 'CREATE')).toBe(false);
    expect(await hasPermission(access, 'DOCUMENTS_PAYMENTS', 'EXPORT')).toBe(false);
    expect(await hasPermission(access, 'EMPLOYEES_REQUISITES', 'VIEW')).toBe(false);

    // Своя касса и остатки остаются доступными.
    expect(await hasPermission(access, 'POS', 'CREATE')).toBe(true);
    expect(await hasPermission(access, 'STOCK', 'VIEW')).toBe(true);
  });

  it('purchasing_manager_works_with_orders_but_not_with_employees', async () => {
    const store = await createStore(3);
    await inviteEmployee(store.companyId, store.ownerId, '+77202222222', 'PURCHASING_MANAGER');
    const manager = await prisma.user.create({ data: { phone: '+77202222222' } });
    await acceptPendingInvitations(manager.id, '+77202222222');
    const access = await accessFor(manager.id, store.companyId);

    expect(await hasPermission(access, 'SWIPE_ORDERS', 'CREATE')).toBe(true);
    expect(await hasPermission(access, 'ACCEPTANCE', 'CREATE')).toBe(true);
    expect(await hasPermission(access, 'EMPLOYEES_REQUISITES', 'UPDATE')).toBe(false);
  });
});

describe('приглашения', () => {
  it('invited_employee_joins_company_by_login_code', async () => {
    const store = await createStore(4);
    const invited = await inviteEmployee(
      store.companyId,
      store.ownerId,
      '+7 720 333 33 33',
      'STOREKEEPER',
    );
    expect(invited.status).toBe('ok');

    const employee = await prisma.user.create({ data: { phone: '+77203333333' } });
    const joined = await acceptPendingInvitations(employee.id, '+77203333333');

    expect(joined).toEqual([store.companyId]);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_companyId: { userId: employee.id, companyId: store.companyId } },
    });
    expect(membership.status).toBe('ACTIVE');

    const invitation = await prisma.invitation.findFirstOrThrow({
      where: { companyId: store.companyId },
    });
    expect(invitation.status).toBe('ACCEPTED');
  });

  it('invitation_expires_after_seven_days', async () => {
    const store = await createStore(5);
    await inviteEmployee(store.companyId, store.ownerId, '+77204444444', 'CASHIER');

    await prisma.invitation.updateMany({
      where: { companyId: store.companyId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const employee = await prisma.user.create({ data: { phone: '+77204444444' } });
    const joined = await acceptPendingInvitations(employee.id, '+77204444444');

    expect(joined).toEqual([]);
    const invitation = await prisma.invitation.findFirstOrThrow({
      where: { companyId: store.companyId },
    });
    expect(invitation.status).toBe('EXPIRED');
  });

  it('invitation_rejects_wrong_phone_and_existing_member', async () => {
    const store = await createStore(6);

    expect(await inviteEmployee(store.companyId, store.ownerId, '12345', 'CASHIER')).toEqual({
      status: 'invalid_phone',
    });

    const owner = await prisma.user.findUniqueOrThrow({ where: { id: store.ownerId } });
    expect(await inviteEmployee(store.companyId, store.ownerId, owner.phone, 'CASHIER')).toEqual({
      status: 'already_member',
    });
  });
});

describe('блокировка сотрудника', () => {
  it('blocked_employee_loses_access_and_sessions_immediately', async () => {
    const store = await createStore(7);
    await inviteEmployee(store.companyId, store.ownerId, '+77205555555', 'STOREKEEPER');
    const employee = await prisma.user.create({ data: { phone: '+77205555555' } });
    await acceptPendingInvitations(employee.id, '+77205555555');

    await prisma.session.create({
      data: { userId: employee.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_companyId: { userId: employee.id, companyId: store.companyId } },
    });

    const result = await blockEmployee(store.companyId, store.ownerId, membership.id);
    expect(result.status).toBe('ok');

    // Доступ пропадает сразу, сессии завершаются.
    expect(await prisma.session.count({ where: { userId: employee.id } })).toBe(0);
    const access = await accessFor(employee.id, store.companyId);
    expect(await hasPermission(access, 'STOCK', 'VIEW')).toBe(false);
  });

  it('blocked_employee_documents_stay_in_company', async () => {
    const store = await createStore(8);
    await inviteEmployee(store.companyId, store.ownerId, '+77206666666', 'STOREKEEPER');
    const employee = await prisma.user.create({ data: { phone: '+77206666666' } });
    await acceptPendingInvitations(employee.id, '+77206666666');
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_companyId: { userId: employee.id, companyId: store.companyId } },
    });

    await blockEmployee(store.companyId, store.ownerId, membership.id);

    // История и связь с компанией остаются.
    const stored = await prisma.membership.findUniqueOrThrow({ where: { id: membership.id } });
    expect(stored.status).toBe('BLOCKED');
    expect(stored.companyId).toBe(store.companyId);
  });

  it('owner_cannot_be_blocked', async () => {
    const store = await createStore(9);
    const ownerMembership = await prisma.membership.findFirstOrThrow({
      where: { companyId: store.companyId, role: 'OWNER' },
    });

    expect(await blockEmployee(store.companyId, store.ownerId, ownerMembership.id)).toEqual({
      status: 'cannot_block_owner',
    });
  });

  it('unblocked_employee_gets_access_back', async () => {
    const store = await createStore(10);
    await inviteEmployee(store.companyId, store.ownerId, '+77207777777', 'ACCOUNTANT');
    const employee = await prisma.user.create({ data: { phone: '+77207777777' } });
    await acceptPendingInvitations(employee.id, '+77207777777');
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_companyId: { userId: employee.id, companyId: store.companyId } },
    });

    await blockEmployee(store.companyId, store.ownerId, membership.id);
    await unblockEmployee(store.companyId, store.ownerId, membership.id);

    const access = await accessFor(employee.id, store.companyId);
    expect(await hasPermission(access, 'DOCUMENTS_PAYMENTS', 'VIEW')).toBe(true);
  });

  it('employee_actions_are_written_to_audit_log', async () => {
    const store = await createStore(11);
    await inviteEmployee(store.companyId, store.ownerId, '+77208888888', 'CASHIER');
    const employee = await prisma.user.create({ data: { phone: '+77208888888' } });
    await acceptPendingInvitations(employee.id, '+77208888888');
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_companyId: { userId: employee.id, companyId: store.companyId } },
    });
    await blockEmployee(store.companyId, store.ownerId, membership.id);

    const log = await prisma.auditLog.findMany({
      where: { companyId: store.companyId },
      orderBy: { createdAt: 'asc' },
    });
    expect(log.map((entry) => entry.action)).toEqual([
      'employee_invited',
      'employee_joined',
      'employee_blocked',
    ]);
  });
});
