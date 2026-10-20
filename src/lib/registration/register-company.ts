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
  /** БИН нет в реестре: реквизиты вводит сам пользователь, их сверяет администратор. */
  manual?: { name?: string; legalAddress?: string; legalForm?: string; isVatPayer?: boolean };
};

export type RegisterCompanyResult =
  | { status: 'created'; companyId: string }
  | { status: 'access_requested'; companyId: string }
  | { status: 'invalid_bin' }
  | { status: 'missing_company_details' }
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

  const needsLocation = input.type === 'STORE' || input.type === 'BOTH';
  const needsDelivery = input.type === 'SUPPLIER' || input.type === 'BOTH';
  const address = typeof input.location?.address === 'string' ? input.location.address.trim() : '';
  if (needsLocation && !address) return { status: 'missing_location' };
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

  const details = companyDetails(input);
  if (!details) return { status: 'missing_company_details' };

  // Раздел 3.11 ТЗ: компания встаёт на проверку. В демо включён флаг автопроверки.
  const autoVerify = await isAutoVerifyEnabled();

  const company = await prisma.$transaction(async (tx) => {
    const created = await tx.company.create({
      data: {
        bin: input.bin,
        type: input.type,
        name: details.name,
        legalForm: details.legalForm,
        legalAddress: details.legalAddress,
        isVatPayer: details.isVatPayer,
        // «Проверена» ставит модератор или флаг автопроверки.
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
          address,
          format: input.location.format ?? null,
        },
      });
    }

    await tx.verificationRequest.create({
      data: {
        companyId: created.id,
        status: autoVerify ? 'APPROVED' : 'PENDING',
        fromRegistry: details.fromRegistry,
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

  console.info(
    `[registration] создана компания по БИН ${maskBin(input.bin)}` +
      (details.fromRegistry ? '' : ', реквизиты введены вручную'),
  );
  return { status: 'created', companyId: company.id };
}

const LEGAL_FORMS = ['IP', 'TOO', 'AO'] as const;
type LegalForm = (typeof LEGAL_FORMS)[number];

const MAX_NAME = 200;
const MAX_ADDRESS = 300;

type CompanyDetails = {
  name: string;
  legalForm: LegalForm;
  legalAddress: string;
  isVatPayer: boolean;
  fromRegistry: boolean;
};

/**
 * Реквизиты компании: из реестра БИН, а если БИН там нет — введённые пользователем.
 * Реестр сейчас — мок с тестовыми компаниями.
 * TODO(open-question): источник настоящего реестра (stat.gov.kz, kgd.gov.kz или
 * платный агрегатор) и доступ к нему выбирает заказчик. До подключения настоящая
 * компания вводит название и адрес сама, администратор видит пометку при проверке.
 */
function companyDetails(input: RegisterCompanyInput): CompanyDetails | null {
  const entry = lookupBin(input.bin);
  if (entry) {
    return {
      name: entry.name,
      legalForm: entry.legalForm,
      legalAddress: entry.legalAddress,
      isVatPayer: entry.isVatPayer,
      fromRegistry: true,
    };
  }

  // Тело запроса не типизировано: не строку считаем пустым полем, а не роняем сервер.
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const name = text(input.manual?.name);
  const legalAddress = text(input.manual?.legalAddress);
  if (!name || !legalAddress || name.length > MAX_NAME || legalAddress.length > MAX_ADDRESS) {
    return null;
  }
  const legalForm = LEGAL_FORMS.find((form) => form === input.manual?.legalForm);
  return {
    name,
    legalAddress,
    legalForm: legalForm ?? defaultLegalForm(input.bin),
    isVatPayer: input.manual?.isVatPayer === true,
    fromRegistry: false,
  };
}

/**
 * ИИН начинается с даты рождения: пятая цифра — десятки дня (0–3). У БИН на этом месте
 * тип организации (4–6). Поэтому по ИИН регистрируется ИП, по БИН по умолчанию ТОО.
 */
export function defaultLegalForm(bin: string): LegalForm {
  return Number(bin[4]) <= 3 ? 'IP' : 'TOO';
}
