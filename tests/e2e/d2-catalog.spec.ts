import { expect, test, type Page } from '@playwright/test';
import { buildCatalogXlsx, validRow } from '../helpers/catalog-fixture';

/**
 * Один поставщик на весь файл: БИН в базе уникален, повторная регистрация
 * по тому же БИН намеренно создаёт запрос на доступ, а не вторую компанию.
 */
test.describe.configure({ mode: 'serial' });

const SUPPLIER_BIN: Record<string, string> = {
  'phone-375': '130540001359',
  'desktop-1280': '160940002466',
};

let page: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  page = await browser.newPage();
  const bin = SUPPLIER_BIN[testInfo.project.name]!;

  await page.goto('/ru/login');
  await page
    .getByTestId('phone-input')
    .fill(`+7702${String(testInfo.project.name.length).padStart(7, '0')}`);
  await page.getByTestId('request-code').click();
  const code = await page.getByTestId('demo-code').textContent();
  await page.getByTestId('code-input').fill(code!);
  await page.getByTestId('verify-code').click();

  await page.waitForURL(/\/onboarding$/);
  await page.getByTestId('type-SUPPLIER').click();
  await page.getByTestId(`demo-bin-${bin}`).click();
  await page.getByRole('checkbox', { name: 'Тараз' }).check();
  await page.getByTestId('consent-checkbox').check();
  await page.getByTestId('submit-company').click();
  await page.waitForURL(/\/dashboard$/);
});

test.afterAll(async () => {
  await page.close();
});

async function uploadCatalog(rows: Parameters<typeof buildCatalogXlsx>[0]) {
  await page.getByTestId('catalog-file').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await buildCatalogXlsx(rows),
  });
  await page.getByTestId('upload-catalog').click();
  await expect(page.getByTestId('import-result')).toBeVisible({ timeout: 180_000 });
}

test('supplier_uploads_200_products_from_excel', async () => {
  await page.getByTestId('go-catalog').click();
  await page.waitForURL(/\/catalog$/);

  await uploadCatalog(Array.from({ length: 200 }, (_, index) => validRow(index + 1)));

  await expect(page.getByTestId('import-created')).toHaveText('Добавлено товаров: 200');
  await expect(page.getByTestId('import-errors-count')).toHaveText('Строк с ошибками: 0');
  await expect(page.getByTestId('offers-total')).toHaveText('Всего позиций: 200');
});

test('supplier_downloads_excel_template', async () => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('download-template').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('catalog-template.xlsx');
});

test('catalog_import_errors_point_to_row_numbers', async () => {
  await uploadCatalog([
    validRow(501),
    validRow(502, { barcode: '1234567890123' }),
    validRow(503, { nameKk: '' }),
    validRow(504, { priceWithoutVat: '10.555' }),
  ]);

  await expect(page.getByTestId('import-created')).toHaveText('Добавлено товаров: 1');
  await expect(page.getByTestId('import-errors-count')).toHaveText('Строк с ошибками: 3');

  const errors = page.getByTestId('import-errors').getByRole('listitem');
  await expect(errors.nth(0)).toContainText('Строка 3');
  await expect(errors.nth(0)).toContainText('EAN-13');
  await expect(errors.nth(1)).toContainText('Строка 4');
  await expect(errors.nth(2)).toContainText('Строка 5');
  await expect(errors.nth(2)).toContainText('2 знаков после запятой');
});

test('catalog_search_filters_by_name', async () => {
  // Подстрочный поиск: «товар 7» нашёл бы ещё 70–79, поэтому берём уникальное имя.
  await page.getByTestId('catalog-search').fill('Тестовый товар 199');
  await expect(page.getByTestId('offers-table').getByRole('row')).toHaveCount(1);
  await page.getByTestId('catalog-search').fill('');
});

test('supplier_saves_delivery_zones', async () => {
  await page.getByRole('checkbox', { name: 'Алматы', exact: true }).check();
  await page.getByTestId('save-zones').click();

  await expect(page.getByTestId('zones-saved')).toHaveText('Сохранено городов: 2');
});
