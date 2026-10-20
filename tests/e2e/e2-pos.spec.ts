import { expect, test, type Page } from '@playwright/test';
import { testPoolBin } from '@/mocks/bin-registry';

/** Касса (этап 2, раздел 4.2 ТЗ): уровень логики, один прогон. */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const ONLY_PROJECT = 'desktop-1280';
const BASE = 880;

let storePage: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'касса, один прогон');

  storePage = await browser.newPage();
  await storePage.goto('/ru/login');
  await storePage.getByTestId('phone-input').fill(`+7706${String(BASE).padStart(7, '0')}`);
  await storePage.getByTestId('request-code').click();
  const code = await storePage.getByTestId('demo-code').textContent();
  await storePage.getByTestId('code-input').fill(code!);
  await storePage.getByTestId('verify-code').click();
  await storePage.waitForURL(/\/(onboarding|dashboard)$/);

  await storePage.getByTestId('type-STORE').click();
  await storePage.getByTestId('bin-input').fill(testPoolBin(BASE));
  await storePage.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await storePage.getByTestId('address-input').fill('ул. Демонстрационная, 81');
  await storePage.getByTestId('consent-checkbox').check();
  await storePage.getByTestId('submit-company').click();
  await storePage.waitForURL(/\/dashboard$/);
});

test.afterAll(async () => {
  await storePage?.close();
});

test('cashier_opens_and_closes_shift', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'касса');

  await storePage.goto('/ru/pos');
  await storePage.getByTestId('pos-cash').fill('5000');
  await storePage.getByTestId('open-shift').click();
  await expect(storePage.getByTestId('pos-shift')).toContainText('открыта');

  // Без товара на остатке продавать нечего, но смена и отчёт работают.
  await expect(storePage.getByTestId('pos-report')).toContainText('Чеков: 0');

  await storePage.getByTestId('close-shift').click();
  await expect(storePage.getByTestId('pos-shift')).toContainText('закрыта');
});

test('pos_routes_are_closed_without_session', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'касса');

  const anonymous = await browser.newContext();
  expect((await anonymous.request.get('/api/pos/shift')).status()).toBe(401);
  expect(
    (await anonymous.request.post('/api/pos/sale', { data: { clientId: 'x' } })).status(),
  ).toBe(401);
  expect(
    (await anonymous.request.post('/api/pos/refund', { data: { receiptId: 'x' } })).status(),
  ).toBe(401);
  await anonymous.close();
});

test('pos_screen_fits_phone_width', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'касса');

  await storePage.goto('/ru/pos');
  for (const width of [375, 1280]) {
    await storePage.setViewportSize({ width, height: 800 });
    const overflow = await storePage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `ширина ${width} px`).toBeLessThanOrEqual(0);
  }
  await storePage.setViewportSize({ width: 1280, height: 800 });
});
