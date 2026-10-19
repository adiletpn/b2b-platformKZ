import { prisma } from '@/lib/prisma';

/** Флаги функций и настройки платформы лежат в справочнике БД (правило 5). */
export async function getSetting(key: string, fallback = ''): Promise<string> {
  const setting = await prisma.platformSetting.findUnique({ where: { key } });
  return setting?.value ?? fallback;
}

export async function isAutoVerifyEnabled(): Promise<boolean> {
  return (await getSetting('auto_verify_companies', 'false')) === 'true';
}
