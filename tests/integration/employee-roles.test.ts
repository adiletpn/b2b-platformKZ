import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { recordSwipe } from '@/lib/feed/swipe';
import { checkout } from '@/lib/orders/checkout';
import { decideApproval, listPendingApprovals } from '@/lib/orders/approval';
import { createCustomRole, updateEmployeeAccess } from '@/lib/employees/roles';
import { locationAllowed } from '@/lib/employees/permission-matrix';
import { hasPermission } from '@/lib/auth/permissions';
import { inviteEmployee, acceptPendingInvitations } from '@/lib/employees/invitations';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function createStore(index: number) {
  const user = await prisma.user.create({
    data: { phone: `+7792${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const result = await registerCompany({
    userId: user.id,
    bin: testPoolBin(700 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 90' },
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);
  return { companyId: result.companyId, ownerId: user.id, cityId: taraz.id };
}

/** Сотрудник магазина с ролью менеджера по закупкам. */
async function addEmployee(companyId: string, ownerId: string, index: number) {
  const phone = `+7793${String(index).padStart(7, '0')}`;
  const invited = await inviteEmployee(companyId, ownerId, phone, 'PURCHASING_MANAGER');
  if (invited.status !== 'ok') throw new Error(invited.status);

  const user = await prisma.user.create({ data: { phone } });
  await acceptPendingInvitations(user.id, phone);
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { userId_companyId: { userId: user.id, companyId } },
  });
  return { userId: user.id, membershipId: membership.id };
}

/** Каталог поставщика и товар в корзине магазина: хватает для оформления заявки. */
async function cartWithGoods(store: { companyId: string; cityId: string }, index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7794${String(index).padStart(7, '0')}` },
  });
  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(701 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [store.cityId],
    consentAccepted: true,
  });
  if (supplier.status !== 'created') throw new Error(supplier.status);

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(190000 + index, { priceWithoutVat: '1000.00', packSize: 1, minBatch: 10 }),
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

  return { supplierId: supplier.companyId, locationId: location.id };
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

describe('свои роли компании', () => {
  it('owner_creates_custom_role_with_checked_permissions', async () => {
    const store = await createStore(1);

    const created = await createCustomRole(store.companyId, store.ownerId, {
      nameRu: 'Старший кассир',
      nameKk: 'Аға кассир',
      permissions: [
        { section: 'POS', action: 'VIEW' },
        { section: 'POS', action: 'CREATE' },
        { section: 'STOCK', action: 'VIEW' },
      ],
    });

    expect(created.status).toBe('ok');
    if (created.status !== 'ok') return;

    // Правило 5: матрица прав осталась в справочнике БД.
    const permissions = await prisma.permission.findMany({ where: { roleId: created.roleId } });
    expect(permissions).toHaveLength(3);

    const role = await prisma.role.findUniqueOrThrow({ where: { id: created.roleId } });
    expect(role.companyId).toBe(store.companyId);
    expect(role.isTemplate).toBe(false);
  });

  it('custom_role_needs_name_and_permissions', async () => {
    const store = await createStore(2);

    expect(
      await createCustomRole(store.companyId, store.ownerId, {
        nameRu: '  ',
        nameKk: 'Аға кассир',
        permissions: [{ section: 'POS', action: 'VIEW' }],
      }),
    ).toEqual({ status: 'name_required' });

    expect(
      await createCustomRole(store.companyId, store.ownerId, {
        nameRu: 'Старший кассир',
        nameKk: 'Аға кассир',
        permissions: [],
      }),
    ).toEqual({ status: 'permissions_required' });
  });

  it('custom_role_replaces_template_permissions_of_employee', async () => {
    const store = await createStore(3);
    const employee = await addEmployee(store.companyId, store.ownerId, 3);

    const created = await createCustomRole(store.companyId, store.ownerId, {
      nameRu: 'Только склад',
      nameKk: 'Тек қойма',
      permissions: [{ section: 'STOCK', action: 'VIEW' }],
    });
    if (created.status !== 'ok') throw new Error(created.status);

    await updateEmployeeAccess(store.companyId, store.ownerId, employee.membershipId, {
      roleId: created.roleId,
    });

    const access = {
      userId: employee.userId,
      companyId: store.companyId,
      membershipId: employee.membershipId,
      roleCode: 'PURCHASING_MANAGER',
      allowedLocationIds: [],
      orderLimit: null,
    };
    expect(await hasPermission(access, 'STOCK', 'VIEW')).toBe(true);
    // Права шаблона менеджера по закупкам больше не действуют.
    expect(await hasPermission(access, 'SWIPE_ORDERS', 'CREATE')).toBe(false);
  });
});

describe('ограничения сотрудника', () => {
  it('owner_sets_locations_and_money_limits', async () => {
    const store = await createStore(4);
    const employee = await addEmployee(store.companyId, store.ownerId, 4);
    const location = await prisma.location.findFirstOrThrow({
      where: { companyId: store.companyId },
    });

    const result = await updateEmployeeAccess(
      store.companyId,
      store.ownerId,
      employee.membershipId,
      {
        allowedLocationIds: [location.id],
        orderLimit: '50000',
        maxDiscount: '5',
      },
    );

    expect(result).toEqual({ status: 'ok' });
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: employee.membershipId },
    });
    expect(membership.allowedLocationIds).toEqual([location.id]);
    // Правило 1: лимит и скидка хранятся Decimal с двумя знаками.
    expect(membership.orderLimit?.toFixed(2)).toBe('50000.00');
    expect(membership.maxDiscount?.toFixed(2)).toBe('5.00');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: store.companyId, action: 'employee_access_changed' },
    });
    expect(audit.entityId).toBe(employee.membershipId);
  });

  it('foreign_locations_are_ignored_and_owner_is_not_limited', async () => {
    const store = await createStore(5);
    const other = await createStore(6);
    const employee = await addEmployee(store.companyId, store.ownerId, 5);
    const foreign = await prisma.location.findFirstOrThrow({
      where: { companyId: other.companyId },
    });

    // Правило 4: точку чужой компании назначить нельзя.
    await updateEmployeeAccess(store.companyId, store.ownerId, employee.membershipId, {
      allowedLocationIds: [foreign.id],
    });
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { id: employee.membershipId },
    });
    expect(membership.allowedLocationIds).toEqual([]);

    const owner = await prisma.membership.findFirstOrThrow({
      where: { companyId: store.companyId, role: 'OWNER' },
    });
    expect(
      await updateEmployeeAccess(store.companyId, store.ownerId, owner.id, { orderLimit: '100' }),
    ).toEqual({ status: 'owner_not_limited' });
  });

  it('invalid_limit_is_refused', async () => {
    const store = await createStore(7);
    const employee = await addEmployee(store.companyId, store.ownerId, 7);

    expect(
      await updateEmployeeAccess(store.companyId, store.ownerId, employee.membershipId, {
        orderLimit: 'много',
      }),
    ).toEqual({ status: 'invalid_amount' });

    expect(
      await updateEmployeeAccess(store.companyId, store.ownerId, employee.membershipId, {
        maxDiscount: '120',
      }),
    ).toEqual({ status: 'invalid_amount' });
  });

  it('employee_works_only_with_allowed_locations', () => {
    expect(locationAllowed([], 'loc-1')).toBe(true);
    expect(locationAllowed(['loc-1'], 'loc-1')).toBe(true);
    expect(locationAllowed(['loc-2'], 'loc-1')).toBe(false);
  });
});

describe('согласование заявок выше лимита', () => {
  it('order_above_limit_waits_for_owner_and_supplier_is_not_notified', async () => {
    const store = await createStore(8);
    const employee = await addEmployee(store.companyId, store.ownerId, 8);
    const goods = await cartWithGoods(store, 8);
    await updateEmployeeAccess(store.companyId, store.ownerId, employee.membershipId, {
      orderLimit: '100',
    });

    const created = await checkout({
      storeId: store.companyId,
      locationId: goods.locationId,
      cityId: store.cityId,
      userId: employee.userId,
    });
    expect(created.status).toBe('created');
    if (created.status !== 'created') return;
    expect(created.orders[0]!.needsApproval).toBe(true);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.orders[0]!.id } });
    expect(order.status).toBe('DRAFT');
    expect(order.createdById).toBe(employee.userId);
    // Поставщик узнаёт о заявке только после согласования.
    expect(await prisma.notification.count({ where: { companyId: goods.supplierId } })).toBe(0);

    const approvals = await listPendingApprovals(store.companyId);
    expect(approvals.map((row) => row.number)).toEqual([order.number]);
  });

  it('owner_approval_sends_order_to_supplier', async () => {
    const store = await createStore(9);
    const employee = await addEmployee(store.companyId, store.ownerId, 9);
    const goods = await cartWithGoods(store, 9);
    await updateEmployeeAccess(store.companyId, store.ownerId, employee.membershipId, {
      orderLimit: '100',
    });
    const created = await checkout({
      storeId: store.companyId,
      locationId: goods.locationId,
      cityId: store.cityId,
      userId: employee.userId,
    });
    if (created.status !== 'created') throw new Error(created.status);
    const orderId = created.orders[0]!.id;

    expect(await decideApproval(store.companyId, store.ownerId, orderId, true)).toEqual({
      status: 'ok',
      order: 'SENT',
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('SENT');
    expect(order.needsApproval).toBe(false);
    expect(order.approvedById).toBe(store.ownerId);

    const notification = await prisma.notification.findFirstOrThrow({
      where: { companyId: goods.supplierId },
    });
    expect(notification.event).toBe('order_created');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { companyId: store.companyId, action: 'order_approved' },
    });
    expect(audit.entityId).toBe(orderId);
  });

  it('rejection_requires_reason_and_cancels_order', async () => {
    const store = await createStore(10);
    const employee = await addEmployee(store.companyId, store.ownerId, 10);
    const goods = await cartWithGoods(store, 10);
    await updateEmployeeAccess(store.companyId, store.ownerId, employee.membershipId, {
      orderLimit: '100',
    });
    const created = await checkout({
      storeId: store.companyId,
      locationId: goods.locationId,
      cityId: store.cityId,
      userId: employee.userId,
    });
    if (created.status !== 'created') throw new Error(created.status);
    const orderId = created.orders[0]!.id;

    expect(await decideApproval(store.companyId, store.ownerId, orderId, false, '  ')).toEqual({
      status: 'reason_required',
    });

    expect(await decideApproval(store.companyId, store.ownerId, orderId, false, 'дорого')).toEqual({
      status: 'ok',
      order: 'CANCELLED',
    });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('CANCELLED');
    expect(order.rejectionReason).toBe('дорого');
  });

  it('order_within_limit_goes_to_supplier_at_once', async () => {
    const store = await createStore(11);
    const employee = await addEmployee(store.companyId, store.ownerId, 11);
    const goods = await cartWithGoods(store, 11);
    await updateEmployeeAccess(store.companyId, store.ownerId, employee.membershipId, {
      orderLimit: '1000000',
    });

    const created = await checkout({
      storeId: store.companyId,
      locationId: goods.locationId,
      cityId: store.cityId,
      userId: employee.userId,
    });
    if (created.status !== 'created') throw new Error(created.status);

    expect(created.orders[0]!.needsApproval).toBe(false);
    expect(new Decimal(created.orders[0]!.total).greaterThan(0)).toBe(true);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.orders[0]!.id } });
    expect(order.status).toBe('SENT');
    expect(await listPendingApprovals(store.companyId)).toEqual([]);
  });

  it('approval_of_another_company_order_is_refused', async () => {
    const store = await createStore(12);
    const other = await createStore(13);
    const employee = await addEmployee(store.companyId, store.ownerId, 12);
    const goods = await cartWithGoods(store, 12);
    await updateEmployeeAccess(store.companyId, store.ownerId, employee.membershipId, {
      orderLimit: '100',
    });
    const created = await checkout({
      storeId: store.companyId,
      locationId: goods.locationId,
      cityId: store.cityId,
      userId: employee.userId,
    });
    if (created.status !== 'created') throw new Error(created.status);

    // Правило 4: заявку чужой компании согласовать нельзя.
    expect(
      await decideApproval(other.companyId, other.ownerId, created.orders[0]!.id, true),
    ).toEqual({ status: 'not_found' });
    expect(await listPendingApprovals(other.companyId)).toEqual([]);
  });
});
