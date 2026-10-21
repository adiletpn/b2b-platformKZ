import { expect, test } from '@playwright/test';
import { buildCatalogXlsx, gtin13, validRow } from '../helpers/catalog-fixture';
import { expectNoHorizontalScroll, registerPair, type Pair } from '../helpers/e2e-flow';
import { open } from '../helpers/open';

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

/** Разделы 3.4 и 3.5 ТЗ: замена от поставщика и приёмка сканером. */
const BASE: Record<string, number> = { 'phone-375': 900, 'desktop-1280': 920 };

let pair: Pair;
let orderPath: string;
let substituteIndex: number;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const base = BASE[testInfo.project.name]!;
  pair = await registerPair(browser, {
    supplierPhone: `+7770${String(base).padStart(7, '0')}`,
    storePhone: `+7771${String(base).padStart(7, '0')}`,
    binIndex: base,
    productIndex: 150000 + base,
  });
  // Второй товар поставщика — им заменят отсутствующий.
  substituteIndex = 150001 + base;
  const { supplierPage, storePage, productName } = pair;
  await open(supplierPage, '/ru/catalog');
  await supplierPage.getByTestId('catalog-file').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await buildCatalogXlsx([
      validRow(substituteIndex, { priceWithoutVat: '50.00', packSize: 1, minBatch: 1 }),
    ]),
  });
  await supplierPage.getByTestId('upload-catalog').click();
  await expect(supplierPage.getByTestId('import-created')).toHaveText('Добавлено товаров: 1');

  await open(storePage, '/ru/feed');
  await storePage.getByTestId('mode-list').click();
  await storePage.getByTestId('feed-search').fill(productName);
  const quantity = storePage
    .getByTestId('list-table')
    .getByRole('row')
    .filter({ hasText: productName })
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
  orderPath = new URL(supplierPage.url()).pathname;
});

test.afterAll(async () => {
  await pair?.storePage.context().close();
  await pair?.supplierPage.context().close();
});

test('supplier_marks_out_of_stock_and_offers_substitute', async () => {
  const { supplierPage, storePage } = pair;
  const row = supplierPage.getByTestId('order-items').getByRole('row').first();
  await row.getByRole('button', { name: 'Нет в наличии' }).click();
  await row.getByRole('combobox', { name: 'Предложить замену' }).selectOption({
    label: `Тестовый товар ${substituteIndex} · 58 ₸`,
  });
  await row.getByRole('textbox', { name: 'Количество замены' }).fill('3');
  await expectNoHorizontalScroll(supplierPage);
  await supplierPage.getByTestId('accept-partial').click();
  await expect(supplierPage.getByTestId('order-total')).toHaveText('174');

  await open(storePage, orderPath);
  await expect(storePage.getByTestId('order-items')).toContainText(
    `Тестовый товар ${substituteIndex}`,
  );
  await expect(storePage.getByTestId('order-items')).toContainText('замена для');
  await storePage.getByTestId('agree-changes').click();
  await expect(storePage.getByTestId('agree-changes')).toHaveCount(0);
});

test('store_accepts_delivery_by_scanner', async () => {
  const { supplierPage, storePage } = pair;
  await open(supplierPage, orderPath);
  await supplierPage.getByTestId('create-documents').click();
  await expect(supplierPage.getByTestId('document-INVOICE')).toBeVisible();
  for (const status of ['Собирается', 'Отгружена', 'Доставлена']) {
    await supplierPage.getByTestId('next-status').click();
    await expect(supplierPage.getByTestId('order-status')).toHaveText(status);
  }

  await open(storePage, orderPath);
  const scan = storePage.getByTestId('acceptance-scan');
  await scan.fill('0000000000000');
  await scan.press('Enter');
  await expect(storePage.getByTestId('acceptance-scan-miss')).toBeVisible();

  // Сканер печатает код как клавиатура и жмёт Enter: каждый скан — одна единица.
  const barcode = gtin13(String(487020400000 + substituteIndex));
  for (let count = 0; count < 2; count += 1) {
    await scan.fill(barcode);
    await scan.press('Enter');
  }
  await expect(storePage.getByTestId('acceptance-scan-miss')).toHaveCount(0);
  const accepted = storePage
    .getByTestId('acceptance-items')
    .getByRole('row')
    .filter({ hasText: `Тестовый товар ${substituteIndex}` });
  await expect(accepted.getByText('отсканировано 2')).toBeVisible();
  await expect(accepted.getByRole('textbox').first()).toHaveValue('2');
  await expectNoHorizontalScroll(storePage);
});
