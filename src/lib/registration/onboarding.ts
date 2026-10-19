import { prisma } from '@/lib/prisma';

export type OnboardingStep = {
  code: 'requisites' | 'location' | 'zone' | 'catalog' | 'employees';
  done: boolean;
};

export type OnboardingProgress = { steps: OnboardingStep[]; percent: number };

/**
 * Мастер онбординга с подсказками и индикатором заполненности профиля (раздел 3.11 ТЗ).
 * Шаги зависят от типа компании: у поставщика зоны и каталог, у магазина точки.
 */
export async function getOnboardingProgress(companyId: string): Promise<OnboardingProgress> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { type: true, iik: true, bik: true },
  });
  if (!company) return { steps: [], percent: 0 };

  const [locations, zones, offers, employees] = await Promise.all([
    prisma.location.count({ where: { companyId } }),
    prisma.deliveryZone.count({ where: { supplierId: companyId } }),
    prisma.supplierOffer.count({ where: { supplierId: companyId } }),
    prisma.membership.count({ where: { companyId, status: 'ACTIVE' } }),
  ]);

  const isSupplier = company.type !== 'STORE';
  const isStore = company.type !== 'SUPPLIER';

  const steps: OnboardingStep[] = [
    { code: 'requisites', done: Boolean(company.iik && company.bik) },
    ...(isStore ? ([{ code: 'location', done: locations > 0 }] as OnboardingStep[]) : []),
    ...(isSupplier
      ? ([
          { code: 'zone', done: zones > 0 },
          { code: 'catalog', done: offers > 0 },
        ] as OnboardingStep[])
      : []),
    // Владелец считается всегда, поэтому приглашение — это второй участник.
    { code: 'employees', done: employees > 1 },
  ];

  const done = steps.filter((step) => step.done).length;
  return { steps, percent: Math.round((done / steps.length) * 100) };
}
