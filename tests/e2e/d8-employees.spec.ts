import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { testPoolBin } from '@/mocks/bin-registry';
import { open } from '../helpers/open';

/** Сотрудники и права — уровень API и логики, достаточно одного прогона. */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const ONLY_PROJECT = 'desktop-1280';
const BASE = 340;
const CASHIER_PHONE = '+77219000001';

let ownerPage: Page;
let cashierContext: BrowserContext;
let cashierPage: Page;

async function login(page: Page, phone: string) {
  await page.goto('/ru/login');
  await page.getByTestId('phone-input').fill(phone);
  await page.getByTestId('request-code').click();
  const code = await page.getByTestId('demo-code').textContent();
  await page.getByTestId('code-input').fill(code!);
  await page.getByTestId('verify-code').click();
  await page.waitForURL(/\/(onboarding|dashboard)$/);
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Подготовка тяжёлая: регистрации, каталоги и заявки.
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка уровня прав, один прогон');

  ownerPage = await browser.newPage();
  await login(ownerPage, `+7721${String(BASE).padStart(7, '0')}`);
  await ownerPage.getByTestId('type-STORE').click();
  await ownerPage.getByTestId('bin-input').fill(testPoolBin(BASE));
  await ownerPage.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await ownerPage.getByTestId('address-input').fill('ул. Демонстрационная, 14');
  await ownerPage.getByTestId('consent-checkbox').check();
  await ownerPage.getByTestId('submit-company').click();
  await ownerPage.waitForURL(/\/dashboard$/);
});

test.afterAll(async () => {
  await ownerPage?.close();
  await cashierContext?.close();
});

test('owner_invites_cashier_by_phone', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка уровня прав');

  await open(ownerPage, '/ru/employees');
  await ownerPage.waitForURL(/\/employees$/);

  await ownerPage.getByTestId('invite-phone').fill(CASHIER_PHONE);
  await ownerPage.getByTestId('invite-role').selectOption('CASHIER');
  await ownerPage.getByTestId('invite-employee').click();

  await expect(ownerPage.getByTestId('invite-sent')).toBeVisible();
  await expect(ownerPage.getByTestId('invitations')).toContainText('Кассир');
});

test('invited_cashier_enters_by_code_and_sees_only_own_sections', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка уровня прав');

  cashierContext = await browser.newContext();
  cashierPage = await cashierContext.newPage();
  await login(cashierPage, CASHIER_PHONE);

  // Приглашённый сразу попадает в компанию, онбординг не нужен.
  await expect(cashierPage).toHaveURL(/\/dashboard$/);

  // Раздел сотрудников кассиру недоступен.
  await open(cashierPage, '/ru/employees');
  await expect(cashierPage).toHaveURL(/\/dashboard$/);
});

test('cashier_cannot_reach_orders_and_prices_through_api', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка уровня прав');

  // Критерий этапа 1 ТЗ: ни через интерфейс, ни через API.
  for (const path of ['/api/orders', '/api/feed', '/api/cart', '/api/catalog/offers']) {
    const response = await cashierPage.request.get(path);
    expect(response.status(), path).toBe(403);
  }

  const exportResponse = await cashierPage.request.get('/api/catalog/template?locale=ru');
  expect(exportResponse.status()).toBe(403);

  // Новые разделы тоже закрыты ролью: роли, согласование и ручной ввод товара.
  for (const path of ['/api/employees/roles', '/api/orders/approvals', '/api/feed/geography']) {
    expect((await cashierPage.request.get(path)).status(), path).toBe(403);
  }
  const manualOffer = await cashierPage.request.post('/api/catalog/offer', {
    data: { barcode: '4870001000018', nameRu: 'Товар', nameKk: 'Тауар' },
  });
  expect(manualOffer.status()).toBe(403);
  const limits = await cashierPage.request.put('/api/employees/any-membership-id/access', {
    data: { orderLimit: '100' },
  });
  expect(limits.status()).toBe(403);

  // Этап 2: документы, файлы, выгрузки и подпись кассиру тоже закрыты (раздел 3.12 ТЗ).
  for (const path of [
    '/api/files',
    '/api/files/any-file-id',
    '/api/archive/bundle?from=2026-10-01&to=2026-10-31',
    '/api/exports/one-c?kind=sales',
    '/api/exports/csv/catalog',
    '/api/exports/csv/stock',
    '/api/documents/any-document-id/versions',
  ]) {
    expect((await cashierPage.request.get(path)).status(), path).toBe(403);
  }
  for (const path of [
    '/api/documents/any-document-id/sign',
    '/api/documents/any-document-id/correct',
    '/api/orders/any-order-id/online-payment',
    '/api/orders/any-order-id/online-payment/mock-pay',
  ]) {
    expect((await cashierPage.request.post(path, { data: {} })).status(), path).toBe(403);
  }

  // Остатки своей точки кассиру доступны.
  const stock = await cashierPage.request.get('/api/stock');
  expect(stock.status()).toBe(200);

  // А владельцу заявки доступны.
  const ownerOrders = await ownerPage.request.get('/api/orders');
  expect(ownerOrders.status()).toBe(200);
});

test('blocked_cashier_loses_access_immediately', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка уровня прав');

  await open(ownerPage, '/ru/employees');
  const row = ownerPage.getByTestId('employees-table').getByRole('row').nth(1);
  // В строке две кнопки: ограничения и блокировка.
  await row.getByRole('button', { name: 'Заблокировать' }).click();

  await expect(ownerPage.getByTestId('employees-table')).toContainText('Заблокирован');

  // Сессия кассира завершена: остатки больше не отдаются.
  const stock = await cashierPage.request.get('/api/stock');
  expect(stock.status()).toBe(401);

  // Запись о сотруднике остаётся в компании: владелец и заблокированный кассир.
  await expect(ownerPage.getByTestId('employees-table').getByRole('row')).toHaveCount(2);
  await expect(ownerPage.getByTestId('audit-log')).toContainText('Сотрудник заблокирован');
});

test('owner_builds_custom_role_in_permission_matrix', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка уровня прав');

  await open(ownerPage, '/ru/employees');
  await ownerPage.getByTestId('role-name-ru').fill('Старший кассир');
  await ownerPage.getByTestId('role-name-kk').fill('Аға кассир');
  await ownerPage.getByTestId('cell-POS-VIEW').check();
  await ownerPage.getByTestId('cell-STOCK-VIEW').check();
  await ownerPage.getByTestId('create-role').click();

  await expect(ownerPage.getByTestId('role-created')).toBeVisible();
  // Своя роль появляется в выборе при приглашении.
  await expect(ownerPage.getByTestId('invite-role')).toContainText('Старший кассир');
});

test('owner_sets_order_limit_for_employee', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка уровня прав');

  await open(ownerPage, '/ru/employees');
  const employee = ownerPage.getByTestId('employees-table').getByRole('row').nth(1);
  await employee.getByRole('button', { name: 'Ограничения сотрудника' }).click();

  await ownerPage.getByTestId('access-order-limit').fill('50000');
  await ownerPage.getByTestId('access-max-discount').fill('5');
  await ownerPage.getByTestId('access-save').click();

  await expect(ownerPage.getByTestId('access-saved')).toBeVisible();
  // Лимит виден в таблице сотрудников (раздел 3.12 ТЗ).
  await expect(ownerPage.getByTestId('employees-table')).toContainText('50 000');
});

test('owner_transfers_rights_with_code_confirmation', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка уровня прав');

  // Для передачи нужен активный сотрудник: кассира мог заблокировать прошлый тест.
  await open(ownerPage, '/ru/employees');
  const row = ownerPage.getByTestId('employees-table').getByRole('row').nth(1);
  const unblock = row.getByRole('button', { name: 'Разблокировать' });
  if ((await unblock.count()) > 0) await unblock.click();
  await expect(ownerPage.getByTestId('employees-table')).toContainText('Активен');

  await ownerPage.getByTestId('transfer-employee').selectOption({ index: 1 });
  await ownerPage.getByTestId('transfer-request').click();

  // Код в демо показывается на экране, реальной отправки SMS нет.
  const code = await ownerPage.getByTestId('transfer-demo-code').textContent();
  expect(code).toMatch(/^\d{6}$/);
  await ownerPage.getByTestId('transfer-code').fill(code!);
  await ownerPage.getByTestId('transfer-confirm').click();

  await expect(ownerPage.getByTestId('transfer-done')).toBeVisible();

  // Права ушли вместе с ролью: прежний Владелец больше не управляет сотрудниками.
  // Запись в журнале проверяется интеграционным тестом onboarding.test.ts.
  await open(ownerPage, '/ru/employees');
  await ownerPage.waitForURL(/\/dashboard$/);
});

test('employees_and_matrix_fit_phone_width', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка вёрстки');

  await open(ownerPage, '/ru/employees');
  for (const width of [375, 1280]) {
    await ownerPage.setViewportSize({ width, height: 800 });
    // Широкие таблицы прокручиваются внутри своего блока, а не ломают страницу.
    const overflow = await ownerPage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `ширина ${width} px`).toBeLessThanOrEqual(0);
  }
  await ownerPage.setViewportSize({ width: 1280, height: 800 });
});
