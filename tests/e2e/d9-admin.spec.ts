import { expect, test, type Page } from '@playwright/test';
import { testPoolBin } from '@/mocks/bin-registry';
import { open } from '../helpers/open';

/** Админ-панель: уровень логики и прав, достаточно одного прогона. */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const ONLY_PROJECT = 'desktop-1280';
const MODERATOR_PHONE = '+77009000002';
const SUPERADMIN_PHONE = '+77009000001';
const BASE = 370;

let adminPage: Page;

async function adminLogin(page: Page, phone: string) {
  // Выходим из прежней сессии: иначе откроется панель, а не форма входа.
  await page.request.post('/api/admin/logout').catch(() => undefined);
  await open(page, '/ru/admin');
  await page.getByTestId('admin-phone').fill(phone);
  await page.getByTestId('admin-request-code').click();

  // Второй фактор: в демо код показывается на экране.
  const code = await page.getByTestId('admin-demo-code').textContent();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByTestId('admin-code').fill(code!);
  await page.getByTestId('admin-enter').click();
  await expect(page.getByTestId('admin-role')).toBeVisible();
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Подготовка тяжёлая: регистрации, каталоги и заявки.
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'админ-панель, один прогон');
  adminPage = await browser.newPage();

  // Своя компания: вход от имени не должен зависеть от данных других спек.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/ru/login');
  await page.getByTestId('phone-input').fill(`+7731${String(BASE).padStart(7, '0')}`);
  await page.getByTestId('request-code').click();
  const code = await page.getByTestId('demo-code').textContent();
  await page.getByTestId('code-input').fill(code!);
  await page.getByTestId('verify-code').click();
  await page.waitForURL(/\/onboarding$/);

  await page.getByTestId('type-SUPPLIER').click();
  await page.getByTestId('bin-input').fill(testPoolBin(BASE));
  await page.getByRole('checkbox', { name: 'Тараз' }).check();
  await page.getByTestId('consent-checkbox').check();
  await page.getByTestId('submit-company').click();
  await page.waitForURL(/\/dashboard$/);
  await context.close();
});

test.afterAll(async () => {
  await adminPage?.close();
});

test('admin_signs_in_with_second_factor', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'админ-панель');

  await adminLogin(adminPage, MODERATOR_PHONE);
  await expect(adminPage.getByTestId('admin-role')).toHaveText('MODERATOR');
  await expect(adminPage.getByTestId('admin-audit')).toContainText('Вход администратора');
});

test('dashboard_shows_turnover_and_disputes_block', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'админ-панель');

  await adminLogin(adminPage, MODERATOR_PHONE);

  // База общая с другими спеками, поэтому проверяем формат, а не конкретные числа.
  await expect(adminPage.getByTestId('metric-ordersToday')).toHaveText(/^\d+$/);
  await expect(adminPage.getByTestId('metric-gmvMonth')).toHaveText(/^[\d\s]+(,\d{2})? ₸$/);
  await expect(adminPage.getByTestId('metric-conversion')).toHaveText(/^\d+\.\d{2}%$/);

  // Раздел разбора споров виден модератору (раздел 3.13 ТЗ).
  await expect(adminPage.getByRole('heading', { name: 'Споры' })).toBeVisible();
});

test('moderation_queue_and_settings_are_available_to_admins', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'админ-панель');

  // Флаг автопроверки — глобальный, поэтому в параллельном прогоне его не трогаем:
  // решение модератора с причиной проверяется интеграционными тестами admin.test.ts.
  await adminLogin(adminPage, SUPERADMIN_PHONE);
  await expect(adminPage.getByText('Очередь на проверку')).toBeVisible();

  // Настройки платформы меняет только суперадмин (раздел 3.13 ТЗ).
  const allowed = await adminPage.request.put('/api/admin/settings', {
    data: { key: 'platform_name', value: 'B2B-платформа (демо)' },
  });
  expect(allowed.status()).toBe(200);
  await adminPage.reload();
  await expect(adminPage.getByTestId('admin-audit')).toContainText('Изменена настройка платформы');

  await adminLogin(adminPage, MODERATOR_PHONE);
  const refused = await adminPage.request.put('/api/admin/settings', {
    data: { key: 'platform_name', value: 'взлом' },
  });
  expect(refused.status()).toBe(403);
});

test('superadmin_manages_tariffs_and_reference', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'админ-панель');

  await adminLogin(adminPage, SUPERADMIN_PHONE);

  // Тарифы из справочника БД (правило 5).
  await expect(adminPage.getByTestId('plan-START')).toContainText('0');
  await expect(adminPage.getByTestId('plan-PRO')).toContainText('∞');

  // Пробный период назначается компании без счёта.
  await adminPage.getByTestId('subscription-plan').selectOption('START');
  await adminPage.getByTestId('subscription-months').fill('0');
  await adminPage.getByTestId('subscription-save').click();
  await expect(adminPage.getByTestId('subscriptions')).toContainText('Пробный период');

  // Справочник единиц измерения правится из админки. Запись перезаписывается по коду,
  // поэтому проверяем её содержимое, а не прирост счётчика: база общая для прогонов.
  await adminPage.getByTestId('reference-kind').selectOption('unit');
  await adminPage.getByTestId('reference-code').fill('e2e-box');
  await adminPage.getByTestId('reference-name-ru').fill('Ящик (e2e)');
  await adminPage.getByTestId('reference-name-kk').fill('Жәшік (e2e)');
  await adminPage.getByTestId('reference-save').click();

  const reference = await adminPage.request.get('/api/admin/reference');
  const data = (await reference.json()) as { units: { code: string; nameRu: string }[] };
  expect(data.units).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: 'e2e-box', nameRu: 'Ящик (e2e)' })]),
  );
});

test('superadmin_enters_company_on_behalf_with_reason', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'админ-панель');

  await adminLogin(adminPage, SUPERADMIN_PHONE);
  await expect(adminPage.getByTestId('admin-role')).toHaveText('SUPERADMIN');

  await adminPage.getByTestId('impersonation-reason').fill('обращение в поддержку №7');
  await adminPage.getByTestId('impersonation-start').click();

  // Баннер режима поддержки и запись в журнале (раздел 3.13 ТЗ).
  await expect(adminPage.getByTestId('impersonation-banner')).toContainText('режиме поддержки');
  await expect(adminPage.getByTestId('admin-audit')).toContainText('Вход от имени компании');
  await expect(adminPage.getByTestId('admin-audit')).toContainText('обращение в поддержку №7');

  await adminPage.getByTestId('impersonation-stop').click();
  await expect(adminPage.getByTestId('admin-audit')).toContainText('Выход из режима поддержки');
});

test('moderator_cannot_impersonate_company', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'админ-панель');

  await adminLogin(adminPage, MODERATOR_PHONE);
  // Раздел 3.13 ТЗ: вход от имени доступен только Поддержке и Суперадмину.
  await expect(adminPage.getByTestId('impersonation-start')).toHaveCount(0);

  const response = await adminPage.request.post('/api/admin/impersonation', {
    data: { companyId: 'any', reason: 'проверка' },
  });
  expect(response.status()).toBe(403);
});

test('admin_panel_is_closed_without_session', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'админ-панель');

  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();

  await open(page, '/ru/admin');
  await expect(page.getByTestId('admin-phone')).toBeVisible();

  const response = await page.request.post('/api/admin/impersonation', {
    data: { companyId: 'any', reason: 'проверка' },
  });
  expect(response.status()).toBe(401);

  await anonymous.close();
});

test('admin_panel_fits_phone_width', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка вёрстки');

  await adminLogin(adminPage, SUPERADMIN_PHONE);
  for (const width of [375, 1280]) {
    await adminPage.setViewportSize({ width, height: 800 });
    const overflow = await adminPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `ширина ${width} px`).toBeLessThanOrEqual(0);
  }
  await adminPage.setViewportSize({ width: 1280, height: 800 });
});
