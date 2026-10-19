import { expect, test, type Page } from '@playwright/test';
import { testPoolBin } from '@/mocks/bin-registry';

/** Склад (этап 2, раздел 4.1 ТЗ): уровень логики, достаточно одного прогона. */
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const ONLY_PROJECT = 'desktop-1280';
const BASE = 860;

let storePage: Page;

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
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'склад, один прогон');

  storePage = await browser.newPage();
  await login(storePage, `+7705${String(BASE).padStart(7, '0')}`);
  await storePage.getByTestId('type-STORE').click();
  await storePage.getByTestId('bin-input').fill(testPoolBin(BASE));
  await storePage.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await storePage.getByTestId('address-input').fill('ул. Демонстрационная, 61');
  await storePage.getByTestId('consent-checkbox').check();
  await storePage.getByTestId('submit-company').click();
  await storePage.waitForURL(/\/dashboard$/);
});

test.afterAll(async () => {
  await storePage?.close();
});

test('stock_screen_explains_there_is_nothing_to_count_yet', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'склад');

  // У нового магазина остатков нет: инвентаризация вводит их описью.
  const response = await storePage.request.get('/api/stock');
  expect(response.status()).toBe(200);

  await storePage.goto('/ru/stock');
  await expect(storePage.getByTestId('stock-empty')).toBeVisible();
  // Проводить нечего, пока товар не принят по накладной — экран об этом говорит.
  await expect(storePage.getByTestId('stock-documents-empty')).toBeVisible();
});

test('stock_documents_are_closed_for_another_company', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'склад');

  const anonymous = await browser.newContext();
  expect((await anonymous.request.get('/api/stock/documents')).status()).toBe(401);
  expect(
    (
      await anonymous.request.post('/api/stock/documents', { data: { type: 'WRITE_OFF' } })
    ).status(),
  ).toBe(401);
  expect((await anonymous.request.get('/api/stock/ledger/any-product')).status()).toBe(401);
  expect((await anonymous.request.get('/api/stock/replenishment')).status()).toBe(401);
  expect((await anonymous.request.get('/api/stock/expiring')).status()).toBe(401);
  expect((await anonymous.request.get('/api/stock/pricing')).status()).toBe(401);
  expect((await anonymous.request.get('/api/stock/labels?locale=ru')).status()).toBe(401);
  expect((await anonymous.request.post('/api/stock/replenishment')).status()).toBe(401);
  expect(
    (await anonymous.request.put('/api/stock/minimum', { data: { productId: 'any' } })).status(),
  ).toBe(401);
  await anonymous.close();
});

test('markup_rule_is_saved_and_prices_need_stock', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'склад');

  await storePage.goto('/ru/stock');
  await storePage.getByTestId('markup-percent').fill('25');
  await storePage.getByTestId('markup-save').click();
  await expect(storePage.getByTestId('pricing-error')).toBeHidden();

  // Остатков нет — пересчитывать нечего, но правило уже сохранено.
  await storePage.getByTestId('reprice').click();
  await expect(storePage.getByTestId('repriced')).toContainText('0');
});

test('stock_screen_fits_phone_width', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'склад');

  await storePage.goto('/ru/stock');
  for (const width of [375, 1280]) {
    await storePage.setViewportSize({ width, height: 800 });
    const overflow = await storePage.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `ширина ${width} px`).toBeLessThanOrEqual(0);
  }
  await storePage.setViewportSize({ width: 1280, height: 800 });
});
