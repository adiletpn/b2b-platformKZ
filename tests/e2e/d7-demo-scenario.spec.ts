import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { buildCatalogXlsx, validRow } from '../helpers/catalog-fixture';
import { testPoolBin } from '@/mocks/bin-registry';
import { open } from '../helpers/open';

/**
 * Сквозной демо-сценарий: регистрация → каталог → выбор → заявки → накладная →
 * приёмка → остатки → оплата. Ручных правок в базе нет, всё через интерфейс.
 * Критерий 11 раздела 7 демо-ТЗ.
 */
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

const ONLY_PROJECT = 'desktop-1280';
const BASE = 300;
const VALID_IIK = 'KZ07HSBK123456789012';
const PHONE_WIDTH = { width: 375, height: 667 };
const DESKTOP_WIDTH = { width: 1280, height: 800 };

type Supplier = { page: Page; context: BrowserContext; bin: string; product: string };

let storePage: Page;
let suppliers: Supplier[] = [];
let orderNumbers: string[] = [];
/** Заявка, принятая с расхождениями: именно её оплачиваем. */
let acceptedOrderUrl = '';

async function login(page: Page, phone: string) {
  await page.goto('/ru/login');
  await page.getByTestId('phone-input').fill(phone);
  await page.getByTestId('request-code').click();
  const code = await page.getByTestId('demo-code').textContent();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByTestId('code-input').fill(code!);
  await page.getByTestId('verify-code').click();
  await page.waitForURL(/\/(onboarding|dashboard)$/);
}

/** Критерий 9: экран не уезжает за край ни на телефоне, ни на компьютере. */
async function checkBothWidths(page: Page) {
  for (const size of [PHONE_WIDTH, DESKTOP_WIDTH]) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `ширина ${size.width} px, страница ${page.url()}`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize(DESKTOP_WIDTH);
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Подготовка тяжёлая: регистрации, каталоги и заявки.
  test.setTimeout(180_000);
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сквозной сценарий, достаточно одного прогона');

  for (let index = 0; index < 3; index += 1) {
    const context = await browser.newContext({ viewport: DESKTOP_WIDTH });
    suppliers.push({
      context,
      page: await context.newPage(),
      bin: testPoolBin(BASE + index),
      product: `Тестовый товар ${95000 + BASE + index}`,
    });
  }
  storePage = await browser.newPage();
});

test.afterAll(async () => {
  await storePage?.close();
  for (const supplier of suppliers) await supplier.context?.close();
  suppliers = [];
  orderNumbers = [];
});

test('criterion_1_supplier_and_store_register_with_mock_sms_and_bin', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сквозной сценарий');

  for (const [index, supplier] of suppliers.entries()) {
    await login(supplier.page, `+7717${String(BASE + index).padStart(7, '0')}`);
    await supplier.page.getByTestId('type-SUPPLIER').click();
    await supplier.page.getByTestId('bin-input').fill(supplier.bin);
    await supplier.page.getByTestId('bin-check').click();
    await expect(supplier.page.getByTestId('bin-found')).toBeVisible();
    await supplier.page.getByRole('checkbox', { name: 'Тараз' }).check();
    await supplier.page.getByTestId('consent-checkbox').check();
    await supplier.page.getByTestId('submit-company').click();
    await supplier.page.waitForURL(/\/dashboard$/);
    await expect(supplier.page.getByTestId('company-status')).toHaveText('Проверена');

    // Реквизиты для счёта.
    await supplier.page.goto('/ru/requisites');
    await supplier.page.getByTestId('iik-input').fill(VALID_IIK);
    await supplier.page.getByTestId('bik-input').fill('HSBKKZKX');
    await supplier.page.getByTestId('bank-input').fill('Тестовый банк');
    await supplier.page.getByTestId('save-requisites').click();
    await expect(supplier.page.getByTestId('requisites-saved')).toBeVisible();
  }

  await login(storePage, `+7718${String(BASE).padStart(7, '0')}`);
  await storePage.getByTestId('type-STORE').click();
  await storePage.getByTestId('bin-input').fill(testPoolBin(BASE + 10));
  await storePage.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await storePage.getByTestId('address-input').fill('ул. Демонстрационная, 11');
  await storePage.getByTestId('consent-checkbox').check();
  await storePage.getByTestId('submit-company').click();
  await storePage.waitForURL(/\/dashboard$/);

  await expect(storePage.getByTestId('company-type')).toHaveText('Магазин');
  await checkBothWidths(storePage);
});

test('criterion_2_supplier_uploads_catalog_from_excel', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сквозной сценарий');

  for (const [index, supplier] of suppliers.entries()) {
    await supplier.page.goto('/ru/catalog');

    // Первый поставщик грузит 200 позиций, остальным хватает одной.
    const rows =
      index === 0
        ? [
            validRow(95000 + BASE, { priceWithoutVat: '100.00', packSize: 1, minBatch: 5 }),
            ...Array.from({ length: 199 }, (_, item) => validRow(96000 + BASE * 10 + item)),
          ]
        : [validRow(95000 + BASE + index, { priceWithoutVat: '200.00', packSize: 1, minBatch: 2 })];

    await supplier.page.getByTestId('catalog-file').setInputFiles({
      name: 'catalog.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: await buildCatalogXlsx(rows),
    });
    await supplier.page.getByTestId('upload-catalog').click();
    await expect(supplier.page.getByTestId('import-result')).toBeVisible({ timeout: 180_000 });
    await expect(supplier.page.getByTestId('import-errors-count')).toHaveText(
      'Строк с ошибками: 0',
    );
    await expect(supplier.page.getByTestId('import-created')).toHaveText(
      `Добавлено товаров: ${rows.length}`,
    );
  }

  await checkBothWidths(suppliers[0]!.page);
});

test('criterion_3_store_picks_products_by_swipe_and_in_list', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сквозной сценарий');

  await open(storePage, '/ru/feed');

  // Свайп на телефоне.
  await storePage.setViewportSize(PHONE_WIDTH);
  await storePage.getByTestId('mode-swipe').click();
  const card = storePage.getByTestId('swipe-card');
  await expect(card).toBeVisible();
  const firstOffer = await card.getAttribute('data-offer-id');

  // Жест мышью идёт в координатах экрана: карточка должна быть в видимой области.
  await card.scrollIntoViewIfNeeded();
  const box = (await card.boundingBox())!;
  await storePage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await storePage.mouse.down();
  await storePage.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 10 });
  await storePage.mouse.up();
  await expect(storePage.getByTestId('feed-notice')).toHaveText('Добавлено в корзину');
  await expect(card).not.toHaveAttribute('data-offer-id', firstOffer!);

  // Отмена возвращает карточку.
  await storePage.getByTestId('swipe-undo').first().click();
  await expect(storePage.getByTestId('feed-notice')).toHaveText('Карточка возвращена');

  // Список на компьютере: берём по одной позиции у каждого поставщика.
  await storePage.setViewportSize(DESKTOP_WIDTH);
  await storePage.getByTestId('mode-list').click();
  for (const supplier of suppliers) {
    await storePage.getByTestId('feed-search').fill(supplier.product);
    // Строку ищем по названию: счётчик строк совпадает и до перезагрузки списка.
    const row = storePage
      .getByTestId('list-table')
      .getByRole('row')
      .filter({ hasText: supplier.product });
    await expect(row).toHaveCount(1);
    const input = row.getByRole('textbox');
    await input.fill('5');
    await input.blur();
    await expect(input).toHaveValue('5.000');
  }

  await checkBothWidths(storePage);
});

test('criterion_4_cart_of_three_suppliers_creates_three_orders', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сквозной сценарий');

  await open(storePage, '/ru/cart');
  await expect(storePage.getByTestId('cart-suppliers-count')).toContainText('3 поставщика');
  await checkBothWidths(storePage);

  await storePage.getByTestId('send-orders').click();
  await storePage.waitForURL(/\/orders$/, { timeout: 60_000 });
  await expect(storePage.getByTestId('orders-table').getByRole('row')).toHaveCount(3);

  orderNumbers = await storePage
    .getByTestId('orders-table')
    .getByRole('row')
    .evaluateAll((rows) => rows.map((row) => row.querySelector('td')?.textContent ?? ''));
  expect(orderNumbers).toHaveLength(3);
});

test('criterion_5_partial_confirmation_needs_store_agreement', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сквозной сценарий');

  const supplier = suppliers[0]!;
  await supplier.page.goto('/ru/orders');
  await supplier.page.getByRole('link', { name: 'Открыть' }).first().click();
  await supplier.page.waitForURL(/\/orders\/[^/]+$/);

  // Подтверждаем 4 из 5.
  await supplier.page.getByTestId('order-items').getByRole('textbox').first().fill('4');
  await supplier.page.getByTestId('accept-partial').click();
  await expect(supplier.page.getByTestId('order-status')).toHaveText('Изменена поставщиком');

  const number = (await supplier.page.getByTestId('order-number').textContent())!;
  await open(storePage, '/ru/orders');
  await storePage.getByTestId(`order-open-${number}`).click();
  await expect(storePage.getByTestId('order-changed-notice')).toBeVisible();
  await storePage.getByTestId('agree-changes').click();
  await expect(storePage.getByTestId('order-status')).toHaveText('Принята');

  // Остальные две заявки поставщики принимают полностью.
  for (const other of suppliers.slice(1)) {
    await other.page.goto('/ru/orders');
    await other.page.getByRole('link', { name: 'Открыть' }).first().click();
    await other.page.waitForURL(/\/orders\/[^/]+$/);
    await other.page.getByTestId('accept-full').click();
    await expect(other.page.getByTestId('order-status')).toHaveText('Принята');
  }
});

test('criterion_6_waybill_and_invoice_are_generated_as_pdf', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сквозной сценарий');

  const supplier = suppliers[0]!;
  // Магазин согласился с изменением на своей странице — у поставщика статус ещё старый.
  await supplier.page.reload();
  await expect(supplier.page.getByTestId('order-status')).toHaveText('Принята');

  await supplier.page.getByTestId('create-documents').click();
  await expect(supplier.page.getByTestId('document-WAYBILL')).toBeVisible();
  await expect(supplier.page.getByTestId('document-INVOICE')).toBeVisible();

  // 4 подтверждённых позиции по 116 ₸ с НДС 16%.
  await expect(supplier.page.getByTestId('document-WAYBILL')).toContainText('464');

  const href = (await supplier.page.getByTestId('document-pdf-WAYBILL').getAttribute('href'))!;
  for (const locale of ['ru', 'kk']) {
    const response = await supplier.page.request.get(href.replace('locale=ru', `locale=${locale}`));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/pdf');
    expect((await response.body()).subarray(0, 4).toString()).toBe('%PDF');
  }

  for (const status of ['Собирается', 'Отгружена', 'Доставлена']) {
    await supplier.page.getByTestId('next-status').click();
    await expect(supplier.page.getByTestId('order-status')).toHaveText(status);
  }
});

test('criterion_7_and_8_acceptance_creates_act_and_grows_stock', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сквозной сценарий');

  await storePage.reload();
  await expect(storePage.getByTestId('order-status')).toHaveText('Доставлена');
  await checkBothWidths(storePage);

  // Принято 3 из 4, одна единица — брак.
  const row = storePage.getByTestId('acceptance-items').getByRole('row').first();
  await row.getByRole('textbox').nth(0).fill('3');
  await row.getByRole('textbox').nth(1).fill('1');
  await storePage.getByTestId('submit-acceptance').click();

  await expect(storePage.getByTestId('acceptance-result')).toContainText('с расхождениями');
  await expect(storePage.getByTestId('acceptance-result')).toContainText('348');

  await storePage.reload();
  await expect(storePage.getByTestId('order-status')).toHaveText('Принята с расхождениями');
  await expect(storePage.getByTestId('document-DISCREPANCY_ACT')).toBeVisible();

  acceptedOrderUrl = storePage.url();

  await open(storePage, '/ru/stock');
  await expect(storePage.getByTestId('stock-table')).toContainText(suppliers[0]!.product);
  await expect(storePage.getByTestId('stock-quantity').first()).toContainText('3.000');
  await checkBothWidths(storePage);
});

test('criterion_demo_payment_is_marked_manually', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сквозной сценарий');

  await open(storePage, acceptedOrderUrl);
  await expect(storePage.getByTestId('order-status')).toHaveText('Принята с расхождениями');

  await storePage.getByTestId('to-payment').click();
  await expect(storePage.getByTestId('order-status')).toHaveText('Ожидает оплаты');
  await expect(storePage.getByTestId('payment-iik')).toHaveText(VALID_IIK);

  await storePage.getByTestId('payment-reference').fill('ПП-700');
  await storePage.getByTestId('submit-payment').click();
  await expect(storePage.getByTestId('payment-result')).toContainText('348');

  await storePage.reload();
  await expect(storePage.getByTestId('order-status')).toHaveText('Оплачена');
});

test('criterion_10_interface_switches_between_russian_and_kazakh', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'сквозной сценарий');

  await open(storePage, '/ru/dashboard');
  await expect(storePage.getByRole('heading', { level: 1 })).toHaveText('Кабинет');

  await storePage.getByTestId('locale-kk').click();
  await expect(storePage).toHaveURL(/\/kk\/dashboard$/);
  await expect(storePage.getByRole('heading', { level: 1 })).toHaveText('Кабинет');
  await expect(storePage.getByTestId('company-status')).toHaveText('Тексерілген');

  // Казахский держится на рабочих экранах, а не только на заглушке.
  await storePage.goto('/kk/orders');
  await expect(storePage.getByRole('heading', { level: 1 })).toHaveText('Өтінімдер');
  await storePage.goto('/kk/stock');
  await expect(storePage.getByRole('heading', { level: 1 })).toHaveText('Қалдықтар');
  await checkBothWidths(storePage);

  await storePage.getByTestId('locale-ru').click();
  await expect(storePage).toHaveURL(/\/ru\/stock$/);
  await expect(storePage.getByRole('heading', { level: 1 })).toHaveText('Остатки');
});
