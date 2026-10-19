import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { buildCatalogXlsx, validRow } from '../helpers/catalog-fixture';
import { testPoolBin } from '@/mocks/bin-registry';

/** Оценки по закрытой заявке — бизнес-логика, достаточно одного прогона. */
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const ONLY_PROJECT = 'desktop-1280';
const BASE = 390;

let storePage: Page;
let supplierContext: BrowserContext;
let supplierPage: Page;
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
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'рейтинги, один прогон');
  productName = `Тестовый товар ${120000 + BASE}`;

  supplierContext = await browser.newContext();
  supplierPage = await supplierContext.newPage();
  await login(supplierPage, `+7742${String(BASE).padStart(7, '0')}`);
  await supplierPage.getByTestId('type-SUPPLIER').click();
  await supplierPage.getByTestId('bin-input').fill(testPoolBin(BASE));
  await supplierPage.getByRole('checkbox', { name: 'Тараз' }).check();
  await supplierPage.getByTestId('consent-checkbox').check();
  await supplierPage.getByTestId('submit-company').click();
  await supplierPage.waitForURL(/\/dashboard$/);

  await supplierPage.goto('/ru/requisites');
  await supplierPage.getByTestId('iik-input').fill('KZ07HSBK123456789012');
  await supplierPage.getByTestId('bik-input').fill('HSBKKZKX');
  await supplierPage.getByTestId('bank-input').fill('Тестовый банк');
  await supplierPage.getByTestId('save-requisites').click();
  await expect(supplierPage.getByTestId('requisites-saved')).toBeVisible();

  await supplierPage.goto('/ru/catalog');
  await supplierPage.getByTestId('catalog-file').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await buildCatalogXlsx([
      validRow(120000 + BASE, { priceWithoutVat: '100.00', packSize: 1, minBatch: 5 }),
    ]),
  });
  await supplierPage.getByTestId('upload-catalog').click();
  await expect(supplierPage.getByTestId('import-created')).toHaveText('Добавлено товаров: 1');

  storePage = await browser.newPage();
  await login(storePage, `+7743${String(BASE).padStart(7, '0')}`);
  await storePage.getByTestId('type-STORE').click();
  await storePage.getByTestId('bin-input').fill(testPoolBin(BASE + 1));
  await storePage.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await storePage.getByTestId('address-input').fill('ул. Демонстрационная, 16');
  await storePage.getByTestId('consent-checkbox').check();
  await storePage.getByTestId('submit-company').click();
  await storePage.waitForURL(/\/dashboard$/);
});

test.afterAll(async () => {
  await storePage?.close();
  await supplierContext?.close();
});

test('order_cannot_be_rated_before_it_is_closed', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'рейтинги');

  await storePage.goto('/ru/feed');
  await storePage.getByTestId('mode-list').click();
  await storePage.getByTestId('feed-search').fill(productName);
  await expect(storePage.getByTestId('list-table')).toContainText(productName);
  // Список перезагружается после дебаунса поиска: ждём, иначе строка подменится под руками.
  await expect(storePage.getByTestId('list-table').getByRole('row')).toHaveCount(1);
  const quantity = storePage
    .getByTestId('list-table')
    .getByRole('row')
    .first()
    .getByRole('textbox');
  await quantity.fill('5');
  await quantity.blur();
  await expect(quantity).toHaveValue('5.000');

  await storePage.goto('/ru/cart');
  await storePage.getByTestId('send-orders').click();
  await storePage.waitForURL(/\/orders$/, { timeout: 30_000 });

  await storePage.getByRole('link', { name: 'Открыть' }).first().click();
  await storePage.waitForURL(/\/orders\/[^/]+$/);

  // Заявка только отправлена — формы оценки нет.
  await expect(storePage.getByTestId('submit-rating')).toHaveCount(0);
});

test('store_rates_supplier_after_order_is_closed', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'рейтинги');

  // Доводим заявку до закрытия обычным путём.
  await supplierPage.goto('/ru/orders');
  await supplierPage.getByRole('link', { name: 'Открыть' }).first().click();
  await supplierPage.waitForURL(/\/orders\/[^/]+$/);
  await supplierPage.getByTestId('accept-full').click();
  await supplierPage.getByTestId('create-documents').click();
  await expect(supplierPage.getByTestId('document-WAYBILL')).toBeVisible();
  for (const status of ['Собирается', 'Отгружена', 'Доставлена']) {
    await supplierPage.getByTestId('next-status').click();
    await expect(supplierPage.getByTestId('order-status')).toHaveText(status);
  }

  await storePage.reload();
  await storePage.getByTestId('submit-acceptance').click();
  await expect(storePage.getByTestId('acceptance-result')).toBeVisible();

  await storePage.reload();
  await storePage.getByTestId('to-payment').click();
  await storePage.getByTestId('submit-payment').click();
  await expect(storePage.getByTestId('payment-result')).toBeVisible();

  await storePage.reload();
  await storePage.getByTestId('next-status').click();
  await expect(storePage.getByTestId('order-status')).toHaveText('Закрыта');

  // Оценка доступна только теперь.
  await storePage.getByTestId('rating-quality').selectOption('5');
  await storePage.getByTestId('rating-matching').selectOption('4');
  await storePage.getByTestId('rating-politeness').selectOption('5');
  await storePage.getByTestId('rating-packaging').selectOption('4');
  await storePage.getByTestId('rating-comment').fill('привезли вовремя');
  await storePage.getByTestId('submit-rating').click();

  await expect(storePage.getByTestId('rating-result')).toContainText('4.50');
});

test('second_rating_for_the_same_order_is_refused', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'рейтинги');

  await storePage.reload();
  // Форма пропала: повторно оценить нельзя.
  await expect(storePage.getByTestId('submit-rating')).toHaveCount(0);
  await expect(storePage.getByTestId('rating-result')).toContainText('4.50');

  const url = storePage.url().replace('/ru/orders/', '/api/orders/');
  const response = await storePage.request.post(`${url}/rating`, {
    data: { criteria: { quality: 1, matching: 1, politeness: 1, packaging: 1 } },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ status: 'already_rated' });
});

test('supplier_sees_rating_with_auto_metrics_and_can_reply', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'рейтинги');

  await supplierPage.goto('/ru/ratings');

  await expect(supplierPage.getByTestId('manual-score')).toHaveText('4.50');
  await expect(supplierPage.getByTestId('ratings-count')).toContainText('1');
  await expect(supplierPage.getByTestId('few-ratings')).toBeVisible();
  await expect(supplierPage.getByTestId('metric-fulfilled')).toContainText('100.00');

  const review = supplierPage.getByTestId('reviews').getByRole('listitem').first();
  await review.getByRole('textbox').fill('спасибо за отзыв');
  await review.getByRole('button', { name: 'Ответить' }).click();

  await expect(supplierPage.getByTestId('reviews')).toContainText('спасибо за отзыв');
});

test('store_sees_payment_discipline_scale', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'рейтинги');

  await storePage.goto('/ru/ratings');
  await expect(storePage.getByTestId('payment-discipline')).toHaveText('Платит в срок');
});
