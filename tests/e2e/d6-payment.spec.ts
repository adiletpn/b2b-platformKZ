import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { buildCatalogXlsx, validRow } from '../helpers/catalog-fixture';
import { testPoolBin } from '@/mocks/bin-registry';
import { open } from '../helpers/open';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/**
 * Платёжный сценарий — бизнес-логика, от вьюпорта не зависит и тяжёл для одного сервера:
 * гоняем в одном проекте. Вёрстка на 375 px проверяется отдельными спеками.
 */
const ONLY_PROJECT = 'desktop-1280';

const BASE: Record<string, number> = { 'phone-375': 200, 'desktop-1280': 220 };
const VALID_IIK = 'KZ07HSBK123456789012';

let storePage: Page;
let supplierContext: BrowserContext;
let supplierPage: Page;
let base: number;
let productName: string;

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
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сценарий уровня логики, один прогон');
  base = BASE[testInfo.project.name]!;
  productName = `Тестовый товар ${90000 + base}`;

  supplierContext = await browser.newContext();
  supplierPage = await supplierContext.newPage();
  await login(supplierPage, `+7715${String(base).padStart(7, '0')}`);
  await supplierPage.getByTestId('type-SUPPLIER').click();
  await supplierPage.getByTestId('bin-input').fill(testPoolBin(base));
  await supplierPage.getByRole('checkbox', { name: 'Тараз' }).check();
  await supplierPage.getByTestId('consent-checkbox').check();
  await supplierPage.getByTestId('submit-company').click();
  await supplierPage.waitForURL(/\/dashboard$/);

  await open(supplierPage, '/ru/catalog');
  await supplierPage.getByTestId('catalog-file').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await buildCatalogXlsx([
      validRow(90000 + base, { priceWithoutVat: '100.00', packSize: 1, minBatch: 5 }),
    ]),
  });
  await supplierPage.getByTestId('upload-catalog').click();
  await expect(supplierPage.getByTestId('import-created')).toHaveText('Добавлено товаров: 1');

  storePage = await browser.newPage();
  await login(storePage, `+7716${String(base).padStart(7, '0')}`);
  await storePage.getByTestId('type-STORE').click();
  await storePage.getByTestId('bin-input').fill(testPoolBin(base + 1));
  await storePage.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await storePage.getByTestId('address-input').fill('ул. Демонстрационная, 9');
  await storePage.getByTestId('consent-checkbox').check();
  await storePage.getByTestId('submit-company').click();
  await storePage.waitForURL(/\/dashboard$/);
});

test.afterAll(async () => {
  await storePage?.close();
  await supplierContext?.close();
});

test('supplier_saves_requisites_with_iban_validation', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сценарий уровня логики, один прогон');

  await open(supplierPage, '/ru/requisites');

  await supplierPage.getByTestId('iik-input').fill('KZ08HSBK123456789012');
  await supplierPage.getByTestId('bik-input').fill('HSBKKZKX');
  await supplierPage.getByTestId('bank-input').fill('Тестовый банк');
  await supplierPage.getByTestId('save-requisites').click();
  await expect(supplierPage.getByTestId('requisites-error')).toContainText('ИИК');

  await supplierPage.getByTestId('iik-input').fill(VALID_IIK);
  await supplierPage.getByTestId('save-requisites').click();
  await expect(supplierPage.getByTestId('requisites-saved')).toBeVisible();
});

test('store_pays_order_manually_and_sees_supplier_requisites', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сценарий уровня логики, один прогон');

  // Заявка проходит путь до приёмки.
  await open(storePage, '/ru/feed');
  await storePage.getByTestId('mode-list').click();
  await storePage.getByTestId('feed-search').fill(productName);
  await expect(storePage.getByTestId('list-table')).toContainText(productName);
  const quantity = storePage
    .getByTestId('list-table')
    .getByRole('row')
    .first()
    .getByRole('textbox');
  await quantity.fill('5');
  await quantity.blur();
  await expect(quantity).toHaveValue('5.000');

  await open(storePage, '/ru/cart');
  await storePage.getByTestId('send-orders').click();
  await storePage.waitForURL(/\/orders$/, { timeout: 30_000 });

  await open(supplierPage, '/ru/orders');
  await supplierPage.getByRole('link', { name: 'Открыть' }).first().click();
  await supplierPage.waitForURL(/\/orders\/[^/]+$/);
  await supplierPage.getByTestId('accept-full').click();
  await supplierPage.getByTestId('create-documents').click();
  await expect(supplierPage.getByTestId('document-INVOICE')).toBeVisible();

  for (const status of ['Собирается', 'Отгружена', 'Доставлена']) {
    await supplierPage.getByTestId('next-status').click();
    await expect(supplierPage.getByTestId('order-status')).toHaveText(status);
  }

  await open(storePage, '/ru/orders');
  await storePage.getByRole('link', { name: 'Открыть' }).first().click();
  await storePage.waitForURL(/\/orders\/[^/]+$/);
  await storePage.getByTestId('submit-acceptance').click();
  await expect(storePage.getByTestId('acceptance-result')).toBeVisible();

  // Выставляем к оплате и отмечаем оплату вручную.
  await storePage.reload();
  await storePage.getByTestId('to-payment').click();
  await expect(storePage.getByTestId('order-status')).toHaveText('Ожидает оплаты');

  await expect(storePage.getByTestId('payment-iik')).toHaveText(VALID_IIK);
  await expect(storePage.getByTestId('payment-bik')).toHaveText('HSBKKZKX');

  await storePage.getByTestId('payment-reference').fill('ПП-125');
  await storePage.getByTestId('submit-payment').click();

  // 5 штук по 116 ₸ с НДС 16%.
  await expect(storePage.getByTestId('payment-result')).toContainText('580');
  await storePage.reload();
  await expect(storePage.getByTestId('order-status')).toHaveText('Оплачена');
  await expect(storePage.getByTestId('order-payments')).toContainText('ПП-125');
});

test('payment_with_wrong_amount_is_rejected', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сценарий уровня логики, один прогон');

  const response = await storePage.request.post(
    `${new URL(storePage.url()).pathname.replace('/ru/orders/', '/api/orders/')}/payment`,
    { data: { amount: '1.00', method: 'ON_DELIVERY', paidAt: '2026-10-19' } },
  );
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ status: 'wrong_status' });
});

test('company_chooses_notification_channels', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'настройки компании');

  await open(storePage, '/ru/requisites');
  // Раздел 3.10 ТЗ: каналы выбирает сам пользователь.
  await storePage.getByTestId('channel-email').uncheck();
  await expect(storePage.getByTestId('channels-saved')).toBeVisible();

  await storePage.reload();
  await expect(storePage.getByTestId('channel-email')).not.toBeChecked();
  await expect(storePage.getByTestId('channel-telegram')).toBeChecked();
});
