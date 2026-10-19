import { prisma } from '@/lib/prisma';
import { getActiveCompany } from './active-company';

export type StoreContext = { companyId: string; locationId: string; cityId: string };

/** Контекст магазина: точка и её город. Правило 4: всё дальше считается только по ним. */
export async function getStoreContext(): Promise<StoreContext | null> {
  const active = await getActiveCompany();
  if (!active) return null;

  const location = await prisma.location.findFirst({
    where: { companyId: active.companyId, type: 'STORE' },
    orderBy: { createdAt: 'asc' },
  });
  if (!location) return null;

  return { companyId: active.companyId, locationId: location.id, cityId: location.cityId };
}
