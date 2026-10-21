import { expect, test, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';
import { gtin13 } from '../helpers/catalog-fixture';
import { outsideRegistryBin } from '../helpers/real-bin';
import { expectNoHorizontalScroll, login } from '../helpers/e2e-flow';
import { CATALOG_COLUMNS } from '@/lib/catalog/columns';
import { open } from '../helpers/open';

/**
 * Основной путь пилота глазами новой компании с настоящим БИН (его нет в мок-реестре):
 * поставщик регистрируется и загружает каталог, магазин в его городе собирает корзину.
 * Свои номера, БИН и штрихкоды на каждую ширину: база общая для обоих прогонов.
 */
test.describe.configure({ mode: 'serial' });

function ids(project: string) {
  const n = project === 'phone-375' ? 1 : 2;
  return {
    supplierPhone: `+77800000${n}01`,
    storePhone: `+77800000${n}02`,
    emptyStorePhone: `+77800000${n}03`,
    supplierBin: outsideRegistryBin(100 + n * 10),
    storeBin: outsideRegistryBin(101 + n * 10),
    emptyStoreBin: outsideRegistryBin(102 + n * 10),
    barcodeBase: 488100000000 + n * 1000,
    product: `Пилотный товар ${n}`,
    emptyCity: n === 1 ? 'Актау' : 'Атырау',
  };
}

async function registerWithEnteredDetails(page: Page, bin: string, name: string) {
  await page.getByTestId('bin-input').fill(bin);
  await page.getByTestId('bin-check').click();
  await expect(page.getByTestId('bin-manual')).toBeVisible();
  await page.getByTestId('manual-company-name').fill(name);
  await page.getByTestId('manual-legal-address').fill('г. Тараз, ул. Толе би, 10');
}

/** Файл, как его заполнит поставщик: первый лист скачанного шаблона. */
async function fillTemplate(template: string, rows: Record<string, string | number>[]) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(template);
  const sheet = workbook.worksheets[0]!;
  for (const row of rows) sheet.addRow(CATALOG_COLUMNS.map((column) => row[column.key] ?? null));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

test('real_company_path_from_supplier_registration_to_store_cart', async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const id = ids(testInfo.project.name);
  const product = (index: number, overrides: Record<string, string | number> = {}) => ({
    barcode: gtin13(String(id.barcodeBase + index)),
    nameRu: `${id.product}.${index}`,
    nameKk: `Пилоттық тауар ${index}`,
    unitCode: 'pcs',
    packSize: 6,
    minBatch: 12,
    priceWithoutVat: 1000,
    vatCode: 'vat-16',
    stock: 100,
    ...overrides,
  });

  // 1. Поставщик: БИН вне реестра, название и адрес вводит сам.
  const supplier = await (await browser.newContext()).newPage();
  await login(supplier, id.supplierPhone);
  await supplier.getByTestId('type-SUPPLIER').click();
  await registerWithEnteredDetails(supplier, id.supplierBin, 'ТОО «Пилот Поставка»');
  await supplier.getByRole('checkbox', { name: 'Тараз' }).check();
  await supplier.getByTestId('consent-checkbox').check();
  await supplier.getByTestId('submit-company').click();
  await supplier.waitForURL(/\/dashboard$/);
  await expect(supplier.getByTestId('company-name')).toHaveText('ТОО «Пилот Поставка»');

  // 2. Условия доставки в Тараз: минимальная сумма с пробелом и запятой, дни доставки.
  await open(supplier, '/ru/catalog');
  const zone = supplier.getByTestId('zone-settings').locator('li').filter({ hasText: 'Тараз' });
  await zone.locator('[data-testid^="zone-min-"]').fill('20 000,00');
  await zone.locator('[data-testid$="-2"][data-testid^="zone-day-"]').click();
  await zone.locator('[data-testid$="-5"][data-testid^="zone-day-"]').click();
  await supplier.getByTestId('save-zones').click();
  await expect(supplier.getByTestId('zones-saved')).toHaveText('Сохранено городов: 1');

  // 3. Каталог из шаблона: верные строки грузятся, ошибка указывает строку и колонку.
  const download = supplier.waitForEvent('download');
  await supplier.getByTestId('download-template').click();
  const file = await fillTemplate((await (await download).path())!, [
    product(1),
    product(2),
    product(3, { nameKk: '' }),
  ]);
  await supplier.getByTestId('catalog-file').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: file,
  });
  await supplier.getByTestId('upload-catalog').click();
  await expect(supplier.getByTestId('import-created')).toHaveText('Добавлено товаров: 2');
  await expect(supplier.getByTestId('import-errors')).toContainText(
    'Строка 4, колонка C «Название (каз)» — Поле обязательно',
  );

  // 4. Товар вручную по штрихкоду.
  await supplier.getByTestId('manual-toggle').click();
  await supplier.getByTestId('manual-barcode').fill(gtin13(String(id.barcodeBase + 4)));
  await supplier.getByTestId('manual-lookup').click();
  await expect(supplier.getByTestId('manual-lookup-notice')).toBeVisible();
  await supplier.getByTestId('manual-name-ru').fill(`${id.product}.4`);
  await supplier.getByTestId('manual-name-kk').fill('Пилоттық тауар 4');
  await supplier.getByTestId('manual-price').fill('1000');
  await supplier.getByTestId('manual-pack-size').fill('6');
  await supplier.getByTestId('manual-min-batch').fill('12');
  await supplier.getByTestId('manual-stock').fill('50');
  await supplier.getByTestId('manual-save').click();
  await expect(supplier.getByTestId('manual-saved')).toBeVisible();
  await expect(supplier.getByTestId('offers-total')).toHaveText('Всего позиций: 3');
  await expectNoHorizontalScroll(supplier);

  // 5. Магазин в Таразе с настоящим БИН: товары поставщика в ленте и списком.
  const store = await (await browser.newContext()).newPage();
  await login(store, id.storePhone);
  await store.getByTestId('type-STORE').click();
  await registerWithEnteredDetails(store, id.storeBin, 'ИП «Пилотный магазин»');
  await store.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await store.getByTestId('address-input').fill('ул. Абая, 1');
  await store.getByTestId('consent-checkbox').check();
  await store.getByTestId('submit-company').click();
  await store.waitForURL(/\/dashboard$/);

  await open(store, '/ru/feed');
  await store.getByTestId('mode-list').click();
  await store.getByTestId('feed-search').fill(id.product);
  const rows = store.getByTestId('list-table').getByRole('row');
  await expect(rows).toHaveCount(3);

  // 6. Корзина: 5 штук поднимаются до минимальной партии 12 (кратно 6).
  const quantity = rows.filter({ hasText: `${id.product}.1` }).getByRole('textbox');
  await quantity.fill('5');
  await quantity.blur();
  await expect(quantity).toHaveValue('12.000');
  await expect(store.getByTestId('feed-notice')).toContainText('минимальной партии');

  await open(store, '/ru/cart');
  const group = store.locator('[data-testid^="cart-group-"]').filter({
    hasText: 'ТОО «Пилот Поставка»',
  });
  await expect(group).toContainText('кратность 6 · мин. партия 12');
  await expect(group.locator('[data-testid^="cart-total-"]')).toHaveText('13 920 ₸');
  await expect(group.locator('[data-testid^="cart-missing-"]')).toContainText('6 080');
  await expectNoHorizontalScroll(store);

  // 7. Магазин в городе, куда никто не возит: лента объясняет, почему пусто.
  const lonely = await (await browser.newContext()).newPage();
  await login(lonely, id.emptyStorePhone);
  await lonely.getByTestId('type-STORE').click();
  await registerWithEnteredDetails(lonely, id.emptyStoreBin, 'ИП «Далёкий магазин»');
  await lonely.getByTestId('city-select').selectOption({ label: id.emptyCity });
  await lonely.getByTestId('address-input').fill('ул. Абая, 2');
  await lonely.getByTestId('consent-checkbox').check();
  await lonely.getByTestId('submit-company').click();
  await lonely.waitForURL(/\/dashboard$/);
  await open(lonely, '/ru/feed');
  await expect(lonely.getByTestId('feed-no-suppliers')).toContainText(
    `В город ${id.emptyCity} пока не возит ни один поставщик`,
  );
});
