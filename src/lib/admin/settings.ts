import type { Prisma } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { registryBins } from '@/mocks/bin-registry';

/** Флаги функций и настройки платформы лежат в справочнике БД (правило 5). */
export async function getSetting(key: string, fallback = ''): Promise<string> {
  const setting = await prisma.platformSetting.findUnique({ where: { key } });
  return setting?.value ?? fallback;
}

export async function isAutoVerifyEnabled(): Promise<boolean> {
  return (await getSetting('auto_verify_companies', 'false')) === 'true';
}

/** Флаги, которые суперадмин переключает в админке. */
export const ADMIN_FLAGS = ['hide_demo_companies', 'disable_password_login'] as const;

/** Пилот с настоящими магазинами: тестовые компании мок-реестра им не показываются. */
export async function isHideDemoCompaniesEnabled(): Promise<boolean> {
  return (await getSetting('hide_demo_companies', 'false')) === 'true';
}

/**
 * Какие поставщики видны в ленте, поиске и на карте. При флаге `hide_demo_companies`
 * компании из мок-реестра БИН отсекаются, иначе фильтра нет.
 */
export async function visibleSupplierWhere(): Promise<Prisma.CompanyWhereInput> {
  return (await isHideDemoCompaniesEnabled()) ? { bin: { notIn: registryBins() } } : {};
}
