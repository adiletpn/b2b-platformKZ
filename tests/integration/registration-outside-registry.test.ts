import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetPlatformFlags, resetTransactionalData } from '../helpers/test-db';
import { outsideRegistryBin } from '../helpers/real-bin';
import { registerCompany } from '@/lib/registration/register-company';
import { decideVerification } from '@/lib/admin/moderation';
import { lookupBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function createUser(phone: string) {
  return prisma.user.create({ data: { phone } });
}

async function tarazId() {
  return (await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } })).id;
}

const manual = {
  name: 'ТОО «Пилот»',
  legalAddress: 'г. Тараз, ул. Толе би, 10',
  legalForm: 'TOO',
  isVatPayer: true,
};

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await resetPlatformFlags(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('регистрация по БИН вне реестра', () => {
  it('valid_bin_outside_registry_registers_with_entered_details', async () => {
    const bin = outsideRegistryBin(1);
    expect(lookupBin(bin)).toBeNull();
    const user = await createUser('+77040000001');

    const result = await registerCompany({
      userId: user.id,
      bin,
      type: 'SUPPLIER',
      deliveryCityIds: [await tarazId()],
      consentAccepted: true,
      manual,
    });

    expect(result.status).toBe('created');
    const company = await prisma.company.findUniqueOrThrow({
      where: { bin },
      include: { verificationRequests: true },
    });
    expect(company).toMatchObject({
      name: 'ТОО «Пилот»',
      legalAddress: 'г. Тараз, ул. Толе би, 10',
      legalForm: 'TOO',
      isVatPayer: true,
    });
    // Пометку «данные не из реестра» видит администратор.
    expect(company.verificationRequests[0]!.fromRegistry).toBe(false);
  });

  it('bin_outside_registry_requires_name_and_address', async () => {
    const user = await createUser('+77040000002');
    const base = {
      userId: user.id,
      bin: outsideRegistryBin(2),
      type: 'SUPPLIER' as const,
      deliveryCityIds: [await tarazId()],
      consentAccepted: true,
    };

    expect((await registerCompany(base)).status).toBe('missing_company_details');
    expect(
      (await registerCompany({ ...base, manual: { ...manual, legalAddress: '   ' } })).status,
    ).toBe('missing_company_details');
    expect(await prisma.company.count({ where: { bin: base.bin } })).toBe(0);
  });

  it('invalid_checksum_is_rejected_even_with_entered_details', async () => {
    const user = await createUser('+77040000003');
    const valid = outsideRegistryBin(3);
    const broken = `${valid.slice(0, 11)}${(Number(valid[11]) + 1) % 10}`;

    const result = await registerCompany({
      userId: user.id,
      bin: broken,
      type: 'SUPPLIER',
      deliveryCityIds: [await tarazId()],
      consentAccepted: true,
      manual,
    });

    expect(result.status).toBe('invalid_bin');
  });

  it('duplicate_bin_outside_registry_creates_access_request', async () => {
    const bin = outsideRegistryBin(4);
    const owner = await createUser('+77040000004');
    const second = await createUser('+77040000005');
    const input = {
      bin,
      type: 'STORE' as const,
      location: { cityId: await tarazId(), address: 'ул. Абая, 1' },
      consentAccepted: true,
      manual,
    };

    const first = await registerCompany({ ...input, userId: owner.id });
    // Второй пользователь реквизиты не вводит: компания уже есть, дубль не создаётся.
    const repeat = await registerCompany({ ...input, manual: undefined, userId: second.id });

    expect(first.status).toBe('created');
    expect(repeat.status).toBe('access_requested');
    expect(await prisma.company.count({ where: { bin } })).toBe(1);
    expect(await prisma.companyAccessRequest.count({ where: { userId: second.id } })).toBe(1);
  });

  it('legal_form_defaults_to_ip_for_iin', async () => {
    const user = await createUser('+77040000006');
    // ИИН: дата рождения 01.01.1995, пятая цифра — десятки дня.
    const result = await registerCompany({
      userId: user.id,
      bin: '950101300125',
      type: 'STORE',
      location: { cityId: await tarazId(), address: 'ул. Абая, 2' },
      consentAccepted: true,
      manual: { name: 'ИП Сапарова', legalAddress: 'г. Тараз, ул. Абая, 2' },
    });

    expect(result.status).toBe('created');
    const company = await prisma.company.findUniqueOrThrow({ where: { bin: '950101300125' } });
    expect(company.legalForm).toBe('IP');
  });

  it('admin_reviews_auto_approved_company_with_entered_details', async () => {
    const user = await createUser('+77040000007');
    const result = await registerCompany({
      userId: user.id,
      bin: outsideRegistryBin(5),
      type: 'SUPPLIER',
      deliveryCityIds: [await tarazId()],
      consentAccepted: true,
      manual,
    });
    if (result.status !== 'created') throw new Error(result.status);
    const admin = await prisma.adminUser.findFirstOrThrow({ where: { role: 'MODERATOR' } });
    const request = await prisma.verificationRequest.findFirstOrThrow({
      where: { companyId: result.companyId },
    });
    // Автопроверка одобрила, но реквизиты введены вручную — модератор может их отклонить.
    expect(request.status).toBe('APPROVED');

    const decision = await decideVerification(admin.id, request.id, false, 'Адрес не совпадает');

    expect(decision).toEqual({ status: 'ok', verification: 'REJECTED' });
    const company = await prisma.company.findUniqueOrThrow({ where: { id: result.companyId } });
    expect(company.verificationStatus).toBe('NOT_VERIFIED');
    expect((await decideVerification(admin.id, request.id, true)).status).toBe('already_decided');
  });
});
