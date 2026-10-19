import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { testPoolBin } from '@/mocks/bin-registry';

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

  await ownerPage.getByTestId('go-employees').click();
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
  await cashierPage.goto('/ru/employees');
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

  // Остатки своей точки кассиру доступны.
  const stock = await cashierPage.request.get('/api/stock');
  expect(stock.status()).toBe(200);

  // А владельцу заявки доступны.
  const ownerOrders = await ownerPage.request.get('/api/orders');
  expect(ownerOrders.status()).toBe(200);
});

test('blocked_cashier_loses_access_immediately', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'проверка уровня прав');

  await ownerPage.goto('/ru/employees');
  const row = ownerPage.getByTestId('employees-table').getByRole('row').nth(1);
  await row.getByRole('button').click();

  await expect(ownerPage.getByTestId('employees-table')).toContainText('Заблокирован');

  // Сессия кассира завершена: остатки больше не отдаются.
  const stock = await cashierPage.request.get('/api/stock');
  expect(stock.status()).toBe(401);

  // Запись о сотруднике остаётся в компании: владелец и заблокированный кассир.
  await expect(ownerPage.getByTestId('employees-table').getByRole('row')).toHaveCount(2);
  await expect(ownerPage.getByTestId('audit-log')).toContainText('Сотрудник заблокирован');
});
