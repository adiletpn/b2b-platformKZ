import { prisma } from '@/lib/prisma';
import { getAccess } from './permissions';
import { locationAllowed } from '@/lib/employees/permission-matrix';

export type StoreContext = { companyId: string; locationId: string; cityId: string };

/** Контекст магазина: точка и её город. Правило 4: всё дальше считается только по ним. */
export async function getStoreContext(): Promise<StoreContext | null> {
  const access = await getAccess();
  if (!access) return null;

  const locations = await prisma.location.findMany({
    where: { companyId: access.companyId, type: 'STORE' },
    orderBy: { createdAt: 'asc' },
  });

  // Раздел 3.12 ТЗ: сотрудник работает только с назначенными ему точками.
  const location = locations.find((item) => locationAllowed(access.allowedLocationIds, item.id));
  if (!location) return null;

  return { companyId: access.companyId, locationId: location.id, cityId: location.cityId };
}
