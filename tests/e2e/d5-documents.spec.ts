import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { buildCatalogXlsx, validRow } from '../helpers/catalog-fixture';
import { testPoolBin } from '@/mocks/bin-registry';

test.describe.configure({ mode: 'serial' });
// Сценарий длинный: каталог, заявка, документы, PDF и приёмка.
test.setTimeout(120_000);

const BASE: Record<string, number> = { 'phone-375': 140, 'desktop-1280': 160 };

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
  base = BASE[testInfo.project.name]!;
  productName = `Тестовый товар ${70000 + base}`;

  supplierContext = await browser.newContext();
  supplierPage = await supplierContext.newPage();
  await login(supplierPage, `+7711${String(base).padStart(7, '0')}`);
  await supplierPage.getByTestId('type-SUPPLIER').click();
  await supplierPage.getByTestId('bin-input').fill(testPoolBin(base));
  await supplierPage.getByRole('checkbox', { name: 'Тараз' }).check();
  await supplierPage.getByTestId('consent-checkbox').check();
  await supplierPage.getByTestId('submit-company').click();
  await supplierPage.waitForURL(/\/dashboard$/);

  await supplierPage.getByTestId('go-catalog').click();
  await supplierPage.waitForURL(/\/catalog$/);
  await supplierPage.getByTestId('catalog-file').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await buildCatalogXlsx([
      validRow(70000 + base, { priceWithoutVat: '100.00', packSize: 1, minBatch: 10 }),
    ]),
  });
  await supplierPage.getByTestId('upload-catalog').click();
  await expect(supplierPage.getByTestId('import-created')).toHaveText('Добавлено товаров: 1');

  storePage = await browser.newPage();
  await login(storePage, `+7712${String(base).padStart(7, '0')}`);
  await storePage.getByTestId('type-STORE').click();
  await storePage.getByTestId('bin-input').fill(testPoolBin(base + 1));
  await storePage.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await storePage.getByTestId('address-input').fill('ул. Демонстрационная, 6');
  await storePage.getByTestId('consent-checkbox').check();
  await storePage.getByTestId('submit-company').click();
  await storePage.waitForURL(/\/dashboard$/);

  // Магазин набирает корзину и отправляет заявку.
  await storePage.goto('/ru/feed');
  await storePage.getByTestId('mode-list').click();
  await storePage.getByTestId('feed-search').fill(productName);
  await expect(storePage.getByTestId('list-table')).toContainText(productName);
  await expect(storePage.getByTestId('list-table').getByRole('row')).toHaveCount(1);
  const quantity = storePage
    .getByTestId('list-table')
    .getByRole('row')
    .first()
    .getByRole('textbox');
  await quantity.fill('10');
  await quantity.blur();
  await expect(quantity).toHaveValue('10.000');

  await storePage.goto('/ru/cart');
  await storePage.getByTestId('send-orders').click();
  await storePage.waitForURL(/\/orders$/, { timeout: 30_000 });

  // Поставщик принимает заявку полностью.
  await supplierPage.goto('/ru/orders');
  await supplierPage.getByRole('link', { name: 'Открыть' }).first().click();
  await supplierPage.waitForURL(/\/orders\/[^/]+$/);
  await supplierPage.getByTestId('accept-full').click();
  await expect(supplierPage.getByTestId('order-status')).toHaveText('Принята');
});

test.afterAll(async () => {
  await storePage.close();
  await supplierContext.close();
});

test('supplier_creates_waybill_and_invoice_in_one_click', async () => {
  await supplierPage.getByTestId('create-documents').click();

  await expect(supplierPage.getByTestId('document-WAYBILL')).toContainText('Накладная З-2');
  await expect(supplierPage.getByTestId('document-INVOICE')).toContainText('Счёт на оплату');
  // Заказано 10 штук по 116 ₸ с НДС 16%.
  await expect(supplierPage.getByTestId('document-WAYBILL')).toContainText('1160.00');
});

test('waybill_pdf_opens_in_russian_and_kazakh', async () => {
  const href = await supplierPage.getByTestId('document-pdf-WAYBILL').getAttribute('href');
  expect(href).toContain('/pdf?locale=ru');

  for (const locale of ['ru', 'kk']) {
    const response = await supplierPage.request.get(href!.replace('locale=ru', `locale=${locale}`));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');

    const body = await response.body();
    expect(body.subarray(0, 4).toString()).toBe('%PDF');
    expect(body.byteLength).toBeGreaterThan(1000);
  }
});

test('store_accepts_delivery_with_defect_and_act_is_created', async () => {
  for (const status of ['Собирается', 'Отгружена', 'Доставлена']) {
    await supplierPage.getByTestId('next-status').click();
    await expect(supplierPage.getByTestId('order-status')).toHaveText(status);
  }

  await storePage.goto('/ru/orders');
  await storePage.getByRole('link', { name: 'Открыть' }).first().click();
  await storePage.waitForURL(/\/orders\/[^/]+$/);
  await expect(storePage.getByTestId('order-status')).toHaveText('Доставлена');

  // Принято 8 из 10, две единицы — брак.
  const row = storePage.getByTestId('acceptance-items').getByRole('row').first();
  await row.getByRole('textbox').nth(0).fill('8');
  await row.getByRole('textbox').nth(1).fill('2');
  await storePage.getByTestId('submit-acceptance').click();

  await expect(storePage.getByTestId('acceptance-result')).toContainText('с расхождениями');
  // Сумма пересчитана: 8 × 116 ₸.
  await expect(storePage.getByTestId('acceptance-result')).toContainText('928.00');

  await storePage.reload();
  await expect(storePage.getByTestId('order-status')).toHaveText('Принята с расхождениями');
  await expect(storePage.getByTestId('document-DISCREPANCY_ACT')).toContainText('Акт расхождений');
});

test('store_stock_grows_after_acceptance', async () => {
  await storePage.goto('/ru/stock');

  await expect(storePage.getByTestId('stock-table')).toContainText(productName);
  await expect(storePage.getByTestId('stock-quantity').first()).toContainText('8.000');
});

test('discrepancy_act_pdf_is_available_to_both_sides', async () => {
  // Предыдущий тест увёл магазин на экран остатков.
  await storePage.goto('/ru/orders');
  await storePage.getByRole('link', { name: 'Открыть' }).first().click();
  await storePage.waitForURL(/\/orders\/[^/]+$/);

  const href = await storePage.getByTestId('document-pdf-DISCREPANCY_ACT').getAttribute('href');

  const storeResponse = await storePage.request.get(href!);
  expect(storeResponse.status()).toBe(200);

  const supplierResponse = await supplierPage.request.get(href!);
  expect(supplierResponse.status()).toBe(200);
});
