import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { registerCompany } from '@/lib/registration/register-company';
import { requireMembership } from '@/lib/auth/membership';
import { listBinRegistry } from '@/mocks/bin-registry';

const prisma = createTestPrisma();
const supplierBin = listBinRegistry()[0]!.bin;
const storeBin = listBinRegistry()[3]!.bin;

async function createUser(phone: string) {
  return prisma.user.create({ data: { phone } });
}

async function cityId(code: string) {
  const city = await prisma.city.findUniqueOrThrow({ where: { code } });
  return city.id;
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('регистрация компании', () => {
  it('registration_creates_store_with_owner_membership_and_location', async () => {
    const user = await createUser('+77010000001');
    const almaty = await cityId('almaty');

    const result = await registerCompany({
      userId: user.id,
      bin: storeBin,
      type: 'STORE',
      location: { cityId: almaty, address: 'ул. Демонстрационная, 10', format: 'grocery' },
      consentAccepted: true,
    });

    expect(result.status).toBe('created');
    const company = await prisma.company.findUniqueOrThrow({
      where: { bin: storeBin },
      include: { memberships: true, locations: true },
    });
    // Флаг автопроверки включён в демо, поэтому компания сразу «Проверена».
    expect(company.verificationStatus).toBe('VERIFIED');
    expect(company.memberships).toHaveLength(1);
    expect(company.memberships[0]!.role).toBe('OWNER');
    expect(company.locations[0]!.cityId).toBe(almaty);
  });

  it('registration_creates_supplier_with_delivery_cities', async () => {
    const user = await createUser('+77010000002');
    const taraz = await cityId('taraz');

    const result = await registerCompany({
      userId: user.id,
      bin: supplierBin,
      type: 'SUPPLIER',
      deliveryCityIds: [taraz],
      consentAccepted: true,
    });

    expect(result.status).toBe('created');
    const zones = await prisma.deliveryZone.findMany({ include: { city: true } });
    expect(zones).toHaveLength(1);
    expect(zones[0]!.city.code).toBe('taraz');
  });

  it('registration_rejects_bin_with_wrong_checksum', async () => {
    const user = await createUser('+77010000003');
    const broken = `${storeBin.slice(0, 11)}${(Number(storeBin[11]) + 1) % 10}`;

    const result = await registerCompany({
      userId: user.id,
      bin: broken,
      type: 'SUPPLIER',
      deliveryCityIds: ['x'],
      consentAccepted: true,
    });

    expect(result.status).toBe('invalid_bin');
    expect(await prisma.company.count()).toBe(0);
  });

  it('registration_rejects_bin_missing_from_registry', async () => {
    const user = await createUser('+77010000004');
    // Валидная контрольная сумма, но такого БИН нет в мок-реестре.
    const result = await registerCompany({
      userId: user.id,
      bin: '180340001112',
      type: 'SUPPLIER',
      deliveryCityIds: ['x'],
      consentAccepted: true,
    });

    expect(result.status).toBe('bin_not_found');
    expect(await prisma.company.count()).toBe(0);
  });

  it('registration_requires_location_for_store', async () => {
    const user = await createUser('+77010000005');
    const result = await registerCompany({
      userId: user.id,
      bin: storeBin,
      type: 'STORE',
      consentAccepted: true,
    });
    expect(result.status).toBe('missing_location');
    expect(await prisma.company.count()).toBe(0);
  });

  it('registration_requires_delivery_cities_for_supplier', async () => {
    const user = await createUser('+77010000006');
    const result = await registerCompany({
      userId: user.id,
      bin: supplierBin,
      type: 'SUPPLIER',
      consentAccepted: true,
    });
    expect(result.status).toBe('missing_delivery_cities');
    expect(await prisma.company.count()).toBe(0);
  });

  it('registration_requires_personal_data_consent', async () => {
    const user = await createUser('+77010000030');
    const taraz = await cityId('taraz');

    // Закон РК №94-V: без согласия регистрация не проходит.
    const refused = await registerCompany({
      userId: user.id,
      bin: supplierBin,
      type: 'SUPPLIER',
      deliveryCityIds: [taraz],
      consentAccepted: false,
    });

    expect(refused.status).toBe('consent_required');
    expect(await prisma.company.count()).toBe(0);
  });

  it('registration_stores_consent_and_offer_acceptance_time', async () => {
    const user = await createUser('+77010000031');
    const taraz = await cityId('taraz');

    const result = await registerCompany({
      userId: user.id,
      bin: supplierBin,
      type: 'SUPPLIER',
      deliveryCityIds: [taraz],
      consentAccepted: true,
    });
    expect(result.status).toBe('created');

    const savedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const company = await prisma.company.findUniqueOrThrow({ where: { bin: supplierBin } });
    expect(savedUser.consentAcceptedAt).not.toBeNull();
    expect(company.offerAcceptedAt).not.toBeNull();
  });

  it('duplicate_bin_creates_access_request_instead_of_second_company', async () => {
    const owner = await createUser('+77010000007');
    const newcomer = await createUser('+77010000008');
    const taraz = await cityId('taraz');

    await registerCompany({
      userId: owner.id,
      bin: supplierBin,
      type: 'SUPPLIER',
      deliveryCityIds: [taraz],
      consentAccepted: true,
    });
    const second = await registerCompany({
      userId: newcomer.id,
      bin: supplierBin,
      type: 'SUPPLIER',
      deliveryCityIds: [taraz],
      consentAccepted: true,
    });

    expect(second.status).toBe('access_requested');
    expect(await prisma.company.count()).toBe(1);
    const requests = await prisma.companyAccessRequest.findMany();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.userId).toBe(newcomer.id);
    expect(requests[0]!.status).toBe('PENDING');
  });

  it('repeated_duplicate_bin_does_not_pile_up_requests', async () => {
    const owner = await createUser('+77010000009');
    const newcomer = await createUser('+77010000010');
    const taraz = await cityId('taraz');

    await registerCompany({
      userId: owner.id,
      bin: supplierBin,
      type: 'SUPPLIER',
      deliveryCityIds: [taraz],
      consentAccepted: true,
    });
    await registerCompany({
      userId: newcomer.id,
      bin: supplierBin,
      type: 'SUPPLIER',
      deliveryCityIds: [taraz],
      consentAccepted: true,
    });
    await registerCompany({
      userId: newcomer.id,
      bin: supplierBin,
      type: 'SUPPLIER',
      deliveryCityIds: [taraz],
      consentAccepted: true,
    });

    expect(await prisma.companyAccessRequest.count()).toBe(1);
  });

  it('user_of_one_company_has_no_membership_in_another', async () => {
    const first = await createUser('+77010000011');
    const second = await createUser('+77010000012');
    const almaty = await cityId('almaty');
    const taraz = await cityId('taraz');

    const a = await registerCompany({
      userId: first.id,
      bin: storeBin,
      type: 'STORE',
      location: { cityId: almaty, address: 'ул. Демонстрационная, 1' },
      consentAccepted: true,
    });
    const b = await registerCompany({
      userId: second.id,
      bin: supplierBin,
      type: 'SUPPLIER',
      deliveryCityIds: [taraz],
      consentAccepted: true,
    });

    expect(a.status).toBe('created');
    expect(b.status).toBe('created');
    if (a.status !== 'created' || b.status !== 'created') return;

    expect(await requireMembership(first.id, a.companyId)).not.toBeNull();
    expect(await requireMembership(first.id, b.companyId)).toBeNull();
    expect(await requireMembership(second.id, a.companyId)).toBeNull();
  });
});
