import Decimal from 'decimal.js';
import { prisma } from '@/lib/prisma';
import { writeAdminAudit } from './session';

export type PlanRow = {
  id: string;
  code: string;
  nameRu: string;
  nameKk: string;
  priceMonthly: string;
  maxLocations: number | null;
  maxEmployees: number | null;
  maxProducts: number | null;
  trialDays: number;
  isDefault: boolean;
  isActive: boolean;
};

export async function listPlans(): Promise<PlanRow[]> {
  const plans = await prisma.tariffPlan.findMany({ orderBy: { priceMonthly: 'asc' } });
  return plans.map((plan) => ({
    id: plan.id,
    code: plan.code,
    nameRu: plan.nameRu,
    nameKk: plan.nameKk,
    priceMonthly: plan.priceMonthly.toFixed(2),
    maxLocations: plan.maxLocations,
    maxEmployees: plan.maxEmployees,
    maxProducts: plan.maxProducts,
    trialDays: plan.trialDays,
    isDefault: plan.isDefault,
    isActive: plan.isActive,
  }));
}

export type PlanInput = {
  code: string;
  nameRu: string;
  nameKk: string;
  priceMonthly: string;
  maxLocations?: string;
  maxEmployees?: string;
  maxProducts?: string;
  trialDays?: string;
  isActive?: boolean;
};

export type PlanResult = { status: 'ok'; planId: string } | { status: 'invalid_plan' };

function limit(value: string | undefined) {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('invalid_plan');
  return parsed;
}

/** Тарифный план заводит и правит суперадмин; значения живут в справочнике (правило 5). */
export async function savePlan(adminId: string, input: PlanInput): Promise<PlanResult> {
  const code = input.code.trim().toUpperCase();
  if (!code || !input.nameRu.trim() || !input.nameKk.trim()) return { status: 'invalid_plan' };

  let price: string;
  let limits: {
    maxLocations: number | null;
    maxEmployees: number | null;
    maxProducts: number | null;
  };
  let trialDays: number;
  try {
    const amount = new Decimal(input.priceMonthly.replace(',', '.'));
    if (!amount.isFinite() || amount.isNegative()) return { status: 'invalid_plan' };
    // Правило 1: цена тарифа — Decimal с двумя знаками.
    price = amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    limits = {
      maxLocations: limit(input.maxLocations),
      maxEmployees: limit(input.maxEmployees),
      maxProducts: limit(input.maxProducts),
    };
    trialDays = limit(input.trialDays) ?? 0;
  } catch {
    return { status: 'invalid_plan' };
  }

  const data = {
    nameRu: input.nameRu.trim(),
    nameKk: input.nameKk.trim(),
    priceMonthly: price,
    ...limits,
    trialDays,
    isActive: input.isActive !== false,
  };

  const plan = await prisma.tariffPlan.upsert({
    where: { code },
    update: data,
    create: { code, ...data },
  });

  await writeAdminAudit(adminId, 'tariff_plan_saved', { entity: 'TariffPlan', entityId: plan.id });
  return { status: 'ok', planId: plan.id };
}

export type SubscriptionRow = {
  companyId: string;
  companyName: string;
  planCode: string | null;
  status: string | null;
  expiresAt: string | null;
  amount: string | null;
};

export async function listSubscriptions(): Promise<SubscriptionRow[]> {
  const companies = await prisma.company.findMany({
    include: {
      subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return companies.map((company) => {
    const current = company.subscriptions[0];
    return {
      companyId: company.id,
      companyName: company.name,
      planCode: current?.plan.code ?? null,
      status: current?.status ?? null,
      expiresAt: current?.expiresAt.toISOString() ?? null,
      amount: current?.amount.toFixed(2) ?? null,
    };
  });
}

export type AssignResult =
  | { status: 'ok'; subscriptionId: string; expiresAt: string }
  | { status: 'not_found' }
  | { status: 'invalid_period' };

/**
 * Подписка компании: пробный период из тарифа или продление на месяцы вручную
 * с выставлением счёта платформы (раздел 3.13 ТЗ).
 */
export async function assignPlan(
  adminId: string,
  companyId: string,
  planCode: string,
  months: number,
  now = new Date(),
): Promise<AssignResult> {
  if (!Number.isInteger(months) || months < 0 || months > 24) return { status: 'invalid_period' };

  const [company, plan] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }),
    prisma.tariffPlan.findUnique({ where: { code: planCode.trim().toUpperCase() } }),
  ]);
  if (!company || !plan) return { status: 'not_found' };

  const trial = months === 0;
  const days = trial ? plan.trialDays : months * 30;
  if (trial && plan.trialDays === 0) return { status: 'invalid_period' };

  const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const amount = trial
    ? '0.00'
    : new Decimal(plan.priceMonthly.toString())
        .times(months)
        .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
        .toFixed(2);

  const subscription = await prisma.subscription.create({
    data: {
      companyId,
      planId: plan.id,
      status: trial ? 'TRIAL' : 'ACTIVE',
      startedAt: now,
      expiresAt,
      amount,
    },
  });

  await writeAdminAudit(adminId, 'subscription_assigned', {
    entity: 'Company',
    entityId: companyId,
    reason: `${plan.code}, ${months} мес.`,
  });

  return { status: 'ok', subscriptionId: subscription.id, expiresAt: expiresAt.toISOString() };
}

export type LimitCheck = { withinLimits: boolean; exceeded: string[] };

/** Проверка лимитов тарифа: точки, сотрудники и товары компании (раздел 3.13 ТЗ). */
export async function checkPlanLimits(companyId: string, now = new Date()): Promise<LimitCheck> {
  const subscription = await prisma.subscription.findFirst({
    where: { companyId, expiresAt: { gte: now } },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!subscription) return { withinLimits: true, exceeded: [] };

  const [locations, employees, products] = await Promise.all([
    prisma.location.count({ where: { companyId } }),
    prisma.membership.count({ where: { companyId, status: 'ACTIVE' } }),
    prisma.supplierOffer.count({ where: { supplierId: companyId } }),
  ]);

  const exceeded: string[] = [];
  const { plan } = subscription;
  if (plan.maxLocations !== null && locations > plan.maxLocations) exceeded.push('locations');
  if (plan.maxEmployees !== null && employees > plan.maxEmployees) exceeded.push('employees');
  if (plan.maxProducts !== null && products > plan.maxProducts) exceeded.push('products');

  return { withinLimits: exceeded.length === 0, exceeded };
}

/** Подписки с истёкшим сроком переводятся в EXPIRED (раздел 3.13 ТЗ). */
export async function markExpiredSubscriptions(now = new Date()) {
  const { count } = await prisma.subscription.updateMany({
    where: { status: { in: ['TRIAL', 'ACTIVE'] }, expiresAt: { lt: now } },
    data: { status: 'EXPIRED' },
  });
  return { expired: count };
}
