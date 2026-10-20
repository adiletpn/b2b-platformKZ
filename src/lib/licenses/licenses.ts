import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Лицензируемые товары (раздел 2 ТЗ): алкоголь, табак и т. п. видны и продаются, только
 * когда лицензия есть и у магазина, и у поставщика.
 * TODO(open-question): проверка номера в elicense.kz — внешний вызов, в демо его нет;
 * формат номера не задан ТЗ, проверяем только непустую строку и срок.
 */
export const LICENSE_NUMBER_MAX = 50;

function startOfToday(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function validWhere(now: Date): Prisma.CompanyLicenseWhereInput {
  return { OR: [{ validUntil: null }, { validUntil: { gte: startOfToday(now) } }] };
}

export async function hasValidLicense(companyId: string, now = new Date()) {
  const license = await prisma.companyLicense.findFirst({
    where: { companyId, ...validWhere(now) },
  });
  return license !== null;
}

/**
 * Условие для выборки предложений: магазину без лицензии лицензируемое не показываем,
 * у поставщика без лицензии такие предложения скрыты для всех.
 */
export async function licensedOfferFilter(
  storeId: string,
  now = new Date(),
): Promise<Prisma.SupplierOfferWhereInput> {
  if (!(await hasValidLicense(storeId, now))) return { product: { isLicensed: false } };
  return {
    OR: [{ product: { isLicensed: false } }, { supplier: { license: { is: validWhere(now) } } }],
  };
}

export async function getLicense(companyId: string) {
  const license = await prisma.companyLicense.findUnique({ where: { companyId } });
  return license
    ? {
        number: license.number,
        validUntil: license.validUntil?.toISOString().slice(0, 10) ?? '',
      }
    : null;
}

export type SaveLicenseResult =
  { status: 'ok' } | { status: 'invalid_number' } | { status: 'invalid_date' };

/** Пустой номер снимает лицензию: лицензируемые товары снова скрываются. */
export async function saveLicense(
  companyId: string,
  input: { number: string; validUntil: string },
): Promise<SaveLicenseResult> {
  const number = input.number.trim();
  if (number.length === 0) {
    await prisma.companyLicense.deleteMany({ where: { companyId } });
    return { status: 'ok' };
  }
  if (number.length > LICENSE_NUMBER_MAX) return { status: 'invalid_number' };

  let validUntil: Date | null = null;
  if (input.validUntil.trim()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil.trim())) return { status: 'invalid_date' };
    validUntil = new Date(`${input.validUntil.trim()}T00:00:00Z`);
    if (Number.isNaN(validUntil.getTime())) return { status: 'invalid_date' };
  }

  await prisma.companyLicense.upsert({
    where: { companyId },
    create: { companyId, number, validUntil },
    update: { number, validUntil },
  });
  return { status: 'ok' };
}
