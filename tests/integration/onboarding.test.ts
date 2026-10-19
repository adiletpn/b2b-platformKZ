import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { getOnboardingProgress } from '@/lib/registration/onboarding';
import { confirmOwnerTransfer, requestOwnerTransfer } from '@/lib/registration/owner-transfer';
import { acceptPendingInvitations, inviteEmployee } from '@/lib/employees/invitations';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function createCompany(index: number, type: 'STORE' | 'SUPPLIER') {
  const user = await prisma.user.create({
    data: { phone: `+7795${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const result = await registerCompany({
    userId: user.id,
    bin: testPoolBin(740 + index),
    type,
    ...(type === 'STORE'
      ? { location: { cityId: taraz.id, address: 'ул. Демонстрационная, 100' } }
      : { deliveryCityIds: [taraz.id] }),
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);
  return { companyId: result.companyId, ownerId: user.id };
}

async function addEmployee(companyId: string, ownerId: string, index: number) {
  const phone = `+7796${String(index).padStart(7, '0')}`;
  const invited = await inviteEmployee(companyId, ownerId, phone, 'PURCHASING_MANAGER');
  if (invited.status !== 'ok') throw new Error(invited.status);

  const user = await prisma.user.create({ data: { phone } });
  await acceptPendingInvitations(user.id, phone);
  const membership = await prisma.membership.findUniqueOrThrow({
    where: { userId_companyId: { userId: user.id, companyId } },
  });
  return { userId: user.id, membershipId: membership.id };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.invitation.deleteMany();
  await prisma.auditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('мастер онбординга', () => {
  it('store_progress_counts_requisites_location_and_employees', async () => {
    const store = await createCompany(1, 'STORE');

    const progress = await getOnboardingProgress(store.companyId);

    expect(progress.steps.map((step) => step.code)).toEqual([
      'requisites',
      'location',
      'employees',
    ]);
    // Точка заведена при регистрации, реквизитов и сотрудников пока нет.
    expect(progress.steps.find((step) => step.code === 'location')!.done).toBe(true);
    expect(progress.percent).toBe(33);
  });

  it('supplier_progress_asks_for_zones_and_catalog', async () => {
    const supplier = await createCompany(2, 'SUPPLIER');

    const before = await getOnboardingProgress(supplier.companyId);
    expect(before.steps.map((step) => step.code)).toEqual([
      'requisites',
      'zone',
      'catalog',
      'employees',
    ]);
    expect(before.steps.find((step) => step.code === 'catalog')!.done).toBe(false);

    await importCatalog(
      supplier.companyId,
      toArrayBuffer(await buildCatalogXlsx([validRow(200000)])),
    );

    const after = await getOnboardingProgress(supplier.companyId);
    expect(after.steps.find((step) => step.code === 'catalog')!.done).toBe(true);
    expect(after.percent).toBeGreaterThan(before.percent);
  });

  it('progress_is_full_when_every_step_is_done', async () => {
    const store = await createCompany(3, 'STORE');
    await addEmployee(store.companyId, store.ownerId, 3);
    await prisma.company.update({
      where: { id: store.companyId },
      data: { iik: 'KZ123456789012345678', bik: 'HSBKKZKX' },
    });

    expect((await getOnboardingProgress(store.companyId)).percent).toBe(100);
  });
});

describe('передача прав Владельца', () => {
  it('owner_transfers_rights_after_code_confirmation', async () => {
    const store = await createCompany(4, 'STORE');
    const employee = await addEmployee(store.companyId, store.ownerId, 4);

    const requested = await requestOwnerTransfer(
      store.companyId,
      store.ownerId,
      employee.membershipId,
    );
    expect(requested.status).toBe('ok');
    if (requested.status !== 'ok') return;

    const confirmed = await confirmOwnerTransfer(
      store.companyId,
      store.ownerId,
      requested.transferId,
      requested.code,
    );
    expect(confirmed).toEqual({ status: 'ok', newOwnerMembershipId: employee.membershipId });

    const newOwner = await prisma.membership.findUniqueOrThrow({
      where: { id: employee.membershipId },
    });
    expect(newOwner.role).toBe('OWNER');

    // Прежний Владелец остаётся в компании сотрудником.
    const previous = await prisma.membership.findFirstOrThrow({
      where: { companyId: store.companyId, userId: store.ownerId },
    });
    expect(previous.role).toBe('PURCHASING_MANAGER');

    // Раздел 3.11 ТЗ: передача попадает в журнал.
    const actions = await prisma.auditLog.findMany({
      where: { companyId: store.companyId },
      orderBy: { createdAt: 'asc' },
    });
    expect(actions.map((entry) => entry.action)).toContain('owner_transfer_requested');
    expect(actions.map((entry) => entry.action)).toContain('owner_transferred');
  });

  it('wrong_code_keeps_the_owner', async () => {
    const store = await createCompany(5, 'STORE');
    const employee = await addEmployee(store.companyId, store.ownerId, 5);
    const requested = await requestOwnerTransfer(
      store.companyId,
      store.ownerId,
      employee.membershipId,
    );
    if (requested.status !== 'ok') throw new Error(requested.status);

    expect(
      await confirmOwnerTransfer(store.companyId, store.ownerId, requested.transferId, '000000'),
    ).toEqual({ status: 'invalid_code' });

    const owner = await prisma.membership.findFirstOrThrow({
      where: { companyId: store.companyId, userId: store.ownerId },
    });
    expect(owner.role).toBe('OWNER');
  });

  it('expired_code_is_refused', async () => {
    const store = await createCompany(6, 'STORE');
    const employee = await addEmployee(store.companyId, store.ownerId, 6);
    const requested = await requestOwnerTransfer(
      store.companyId,
      store.ownerId,
      employee.membershipId,
    );
    if (requested.status !== 'ok') throw new Error(requested.status);

    await prisma.ownerTransfer.update({
      where: { id: requested.transferId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect(
      await confirmOwnerTransfer(
        store.companyId,
        store.ownerId,
        requested.transferId,
        requested.code,
      ),
    ).toEqual({ status: 'expired' });
  });

  it('only_owner_can_start_transfer', async () => {
    const store = await createCompany(7, 'STORE');
    const employee = await addEmployee(store.companyId, store.ownerId, 7);

    // Правило 4 и раздел 3.11: сотрудник передать права не может.
    expect(
      await requestOwnerTransfer(store.companyId, employee.userId, employee.membershipId),
    ).toEqual({ status: 'not_owner' });
  });

  it('employee_of_another_company_cannot_be_made_owner', async () => {
    const store = await createCompany(8, 'STORE');
    const other = await createCompany(9, 'STORE');
    const foreign = await prisma.membership.findFirstOrThrow({
      where: { companyId: other.companyId },
    });

    expect(await requestOwnerTransfer(store.companyId, store.ownerId, foreign.id)).toEqual({
      status: 'not_found',
    });
  });
});
