import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { registerCompany } from '@/lib/registration/register-company';
import {
  assignPlan,
  checkPlanLimits,
  listPlans,
  listSubscriptions,
  markExpiredSubscriptions,
  savePlan,
} from '@/lib/admin/tariffs';
import { getReferenceData, saveReferenceEntry } from '@/lib/admin/reference';
import { testPoolBin } from '@/mocks/bin-registry';

const prisma = createTestPrisma();

async function superadmin() {
  return prisma.adminUser.findFirstOrThrow({ where: { role: 'SUPERADMIN' } });
}

async function createStore(index: number) {
  const user = await prisma.user.create({
    data: { phone: `+7797${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
  const result = await registerCompany({
    userId: user.id,
    bin: testPoolBin(760 + index),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 110' },
    consentAccepted: true,
  });
  if (result.status !== 'created') throw new Error(result.status);
  return result.companyId;
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.adminAuditLog.deleteMany();
  // Свои тарифы тестов не должны мешать справочнику из сида.
  await prisma.tariffPlan.deleteMany({ where: { code: { startsWith: 'TEST_' } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('тарифные планы', () => {
  it('seed_provides_plans_with_limits', async () => {
    const plans = await listPlans();

    // Правило 5: тарифы живут в справочнике БД, а не в коде.
    expect(plans.map((plan) => plan.code)).toEqual(['START', 'BUSINESS', 'PRO']);
    const start = plans.find((plan) => plan.code === 'START')!;
    expect(start.priceMonthly).toBe('0.00');
    expect(start.trialDays).toBe(14);
    const pro = plans.find((plan) => plan.code === 'PRO')!;
    expect(pro.maxProducts).toBeNull();
  });

  it('superadmin_saves_plan_with_decimal_price', async () => {
    const admin = await superadmin();

    const result = await savePlan(admin.id, {
      code: 'test_small',
      nameRu: 'Тестовый',
      nameKk: 'Сынақ',
      priceMonthly: '1234,567',
      maxLocations: '2',
      maxEmployees: '',
      trialDays: '7',
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const plan = await prisma.tariffPlan.findUniqueOrThrow({ where: { id: result.planId } });
    // Правило 1: цена округляется до двух знаков.
    expect(plan.priceMonthly.toFixed(2)).toBe('1234.57');
    expect(plan.code).toBe('TEST_SMALL');
    expect(plan.maxLocations).toBe(2);
    expect(plan.maxEmployees).toBeNull();

    const audit = await prisma.adminAuditLog.findFirstOrThrow({
      where: { action: 'tariff_plan_saved' },
    });
    expect(audit.entityId).toBe(result.planId);
  });

  it('plan_without_name_or_with_negative_price_is_refused', async () => {
    const admin = await superadmin();

    expect(
      await savePlan(admin.id, {
        code: 'TEST_BAD',
        nameRu: '  ',
        nameKk: 'Сынақ',
        priceMonthly: '100',
      }),
    ).toEqual({ status: 'invalid_plan' });

    expect(
      await savePlan(admin.id, {
        code: 'TEST_BAD',
        nameRu: 'Тестовый',
        nameKk: 'Сынақ',
        priceMonthly: '-5',
      }),
    ).toEqual({ status: 'invalid_plan' });
  });
});

describe('подписки компаний', () => {
  it('trial_period_comes_from_the_plan', async () => {
    const admin = await superadmin();
    const companyId = await createStore(1);
    const now = new Date('2026-10-19T00:00:00.000Z');

    const result = await assignPlan(admin.id, companyId, 'START', 0, now);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: result.subscriptionId },
    });
    expect(subscription.status).toBe('TRIAL');
    expect(subscription.amount.toFixed(2)).toBe('0.00');
    // Пробный период тарифа «Старт» — 14 дней.
    expect(subscription.expiresAt.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  it('manual_extension_bills_the_months', async () => {
    const admin = await superadmin();
    const companyId = await createStore(2);

    const result = await assignPlan(admin.id, companyId, 'BUSINESS', 3);
    if (result.status !== 'ok') throw new Error(result.status);

    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: result.subscriptionId },
    });
    expect(subscription.status).toBe('ACTIVE');
    // Правило 1: счёт платформы считается Decimal.
    expect(subscription.amount.toFixed(2)).toBe('59700.00');

    const rows = await listSubscriptions();
    const row = rows.find((item) => item.companyId === companyId)!;
    expect(row.planCode).toBe('BUSINESS');
    expect(row.status).toBe('ACTIVE');
  });

  it('unknown_company_or_period_is_refused', async () => {
    const admin = await superadmin();
    const companyId = await createStore(3);

    expect(await assignPlan(admin.id, 'no-such-company', 'START', 1)).toEqual({
      status: 'not_found',
    });
    expect(await assignPlan(admin.id, companyId, 'START', 99)).toEqual({
      status: 'invalid_period',
    });
    // У тарифа «Профи» пробного периода нет.
    expect(await assignPlan(admin.id, companyId, 'PRO', 0)).toEqual({ status: 'invalid_period' });
  });

  it('plan_limits_are_checked_against_company_data', async () => {
    const admin = await superadmin();
    const companyId = await createStore(4);
    await assignPlan(admin.id, companyId, 'START', 1);

    // Точка одна, сотрудник один — лимиты «Старта» не превышены.
    expect(await checkPlanLimits(companyId)).toEqual({ withinLimits: true, exceeded: [] });

    const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });
    await prisma.location.create({
      data: { companyId, cityId: taraz.id, address: 'ул. Вторая, 2', type: 'STORE' },
    });

    expect(await checkPlanLimits(companyId)).toEqual({
      withinLimits: false,
      exceeded: ['locations'],
    });
  });

  it('expired_subscriptions_are_marked', async () => {
    const admin = await superadmin();
    const companyId = await createStore(5);
    const result = await assignPlan(admin.id, companyId, 'BUSINESS', 1);
    if (result.status !== 'ok') throw new Error(result.status);

    await prisma.subscription.update({
      where: { id: result.subscriptionId },
      data: { expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    expect(await markExpiredSubscriptions()).toEqual({ expired: 1 });
    const subscription = await prisma.subscription.findUniqueOrThrow({
      where: { id: result.subscriptionId },
    });
    expect(subscription.status).toBe('EXPIRED');
  });
});

describe('справочники платформы', () => {
  it('reference_data_is_served_from_database', async () => {
    const data = await getReferenceData();

    expect(data.vatRates.length).toBeGreaterThan(0);
    expect(data.units.length).toBeGreaterThan(0);
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.cities.length).toBeGreaterThan(0);
  });

  it('content_manager_adds_unit_and_vat_rate', async () => {
    const admin = await prisma.adminUser.findFirstOrThrow({ where: { role: 'SUPERADMIN' } });

    const unit = await saveReferenceEntry(admin.id, {
      kind: 'unit',
      code: 'box-test',
      nameRu: 'Ящик',
      nameKk: 'Жәшік',
    });
    expect(unit.status).toBe('ok');
    const saved = await prisma.unit.findUniqueOrThrow({ where: { code: 'box-test' } });
    expect(saved.nameKk).toBe('Жәшік');

    const rate = await saveReferenceEntry(admin.id, {
      kind: 'vatRate',
      code: 'vat-test',
      nameRu: 'Тестовая ставка',
      nameKk: 'Сынақ мөлшерлемесі',
      rate: '12,5',
    });
    expect(rate.status).toBe('ok');
    const savedRate = await prisma.vatRate.findUniqueOrThrow({ where: { code: 'vat-test' } });
    // Правило 1: ставка хранится Decimal с двумя знаками.
    expect(savedRate.rate.toFixed(2)).toBe('12.50');

    await prisma.unit.delete({ where: { code: 'box-test' } });
    await prisma.vatRate.delete({ where: { code: 'vat-test' } });
  });

  it('default_vat_rate_stays_single', async () => {
    const admin = await superadmin();

    const result = await saveReferenceEntry(admin.id, {
      kind: 'vatRate',
      code: 'vat-default-test',
      nameRu: 'Новая основная',
      nameKk: 'Жаңа негізгі',
      rate: '16',
      isDefault: true,
    });
    expect(result.status).toBe('ok');

    const defaults = await prisma.vatRate.findMany({ where: { isDefault: true } });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.code).toBe('vat-default-test');

    // Возвращаем справочник в состояние сида: ставка 16% снова основная.
    await prisma.vatRate.delete({ where: { code: 'vat-default-test' } });
    await prisma.vatRate.update({ where: { code: 'vat-16' }, data: { isDefault: true } });
  });

  it('entry_without_code_or_with_wrong_rate_is_refused', async () => {
    const admin = await superadmin();

    expect(
      await saveReferenceEntry(admin.id, {
        kind: 'unit',
        code: '  ',
        nameRu: 'Ящик',
        nameKk: 'Жәшік',
      }),
    ).toEqual({ status: 'invalid_entry' });

    expect(
      await saveReferenceEntry(admin.id, {
        kind: 'vatRate',
        code: 'vat-bad',
        nameRu: 'Ставка',
        nameKk: 'Мөлшерлеме',
        rate: '120',
      }),
    ).toEqual({ status: 'invalid_entry' });
  });
});
