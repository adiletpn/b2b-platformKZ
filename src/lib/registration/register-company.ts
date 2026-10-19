import { prisma } from '@/lib/prisma';
import { isValidBin, maskBin } from '@/lib/bin/checksum';
import { lookupBin } from '@/mocks/bin-registry';
import { isAutoVerifyEnabled } from '@/lib/admin/settings';

export type RegisterCompanyInput = {
  userId: string;
  bin: string;
  type: 'STORE' | 'SUPPLIER' | 'BOTH';
  /** Магазин: адрес и город точки. */
  location?: { cityId: string; address: string; format?: string };
  /** Поставщик: города доставки. */
  deliveryCityIds?: string[];
  /** Раздел 3.11 ТЗ: оферта и согласие на обработку персональных данных. */
  consentAccepted?: boolean;
};

export type RegisterCompanyResult =
  | { status: 'created'; companyId: string }
  | { status: 'access_requested'; companyId: string }
  | { status: 'invalid_bin' }
  | { status: 'bin_not_found' }
  | { status: 'missing_location' }
  | { status: 'missing_delivery_cities' }
  | { status: 'consent_required' };

/**
 * Раздел 3.11 ТЗ: повторный БИН не создаёт дубль, вместо этого уходит запрос Владельцу.
 * Всё создание — одной транзакцией.
 */
export async function registerCompany(input: RegisterCompanyInput): Promise<RegisterCompanyResult> {
  if (!isValidBin(input.bin)) return { status: 'invalid_bin' };
  // Закон РК №94-V: без согласия на обработку ПД регистрация невозможна.
  if (input.consentAccepted !== true) return { status: 'consent_required' };

  const entry = lookupBin(input.bin);
  if (!entry) return { status: 'bin_not_found' };

  const needsLocation = input.type === 'STORE' || input.type === 'BOTH';
  const needsDelivery = input.type === 'SUPPLIER' || input.type === 'BOTH';
  if (needsLocation && !input.location) return { status: 'missing_location' };
  if (needsDelivery && !input.deliveryCityIds?.length) return { status: 'missing_delivery_cities' };

  const existing = await prisma.company.findUnique({ where: { bin: input.bin } });
  if (existing) {
    await prisma.companyAccessRequest.upsert({
      where: { companyId_userId: { companyId: existing.id, userId: input.userId } },
      update: {},
      create: { companyId: existing.id, userId: input.userId },
    });
    console.info(`[registration] БИН ${maskBin(input.bin)} занят, создан запрос на доступ`);
    return { status: 'access_requested', companyId: existing.id };
  }

  // Раздел 3.11 ТЗ: компания встаёт на проверку. В демо включён флаг автопроверки.
  const autoVerify = await isAutoVerifyEnabled();

  const company = await prisma.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        bin: input.bin,
        type: input.type,
        name: entry.name,
        legalForm: entry.legalForm,
        legalAddress: entry.legalAddress,
        isVatPayer: entry.isVatPayer,
        // БИН подтверждён мок-реестром; «Проверена» ставит модератор или флаг автопроверки.
        verificationStatus: autoVerify ? 'VERIFIED' : 'PENDING_REVIEW',
        offerAcceptedAt: new Date(),
      },
    });

    await tx.membership.create({
      data: { userId: input.userId, companyId: created.id, role: 'OWNER' },
    });

    await tx.user.update({
      where: { id: input.userId },
      data: { consentAcceptedAt: new Date() },
    });

    if (needsLocation && input.location) {
      await tx.location.create({
        data: {
          companyId: created.id,
          type: 'STORE',
          cityId: input.location.cityId,
          address: input.location.address,
          format: input.location.format ?? null,
        },
      });
    }

    await tx.verificationRequest.create({
      data: {
        companyId: created.id,
        status: autoVerify ? 'APPROVED' : 'PENDING',
        decidedAt: autoVerify ? new Date() : null,
      },
    });

    if (needsDelivery && input.deliveryCityIds) {
      await tx.deliveryZone.createMany({
        data: input.deliveryCityIds.map((cityId) => ({ supplierId: created.id, cityId })),
      });
    }

    return created;
  });

  console.info(`[registration] создана компания по БИН ${maskBin(input.bin)}`);
  return { status: 'created', companyId: company.id };
}
