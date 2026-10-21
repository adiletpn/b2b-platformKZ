import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { buildCatalogXlsx, validRow } from '../helpers/catalog-fixture';
import { testPoolBin } from '@/mocks/bin-registry';
import { open } from '../helpers/open';

test.describe.configure({ mode: 'serial' });
// Сценарий длинный: три поставщика с каталогами, магазин, корзина и отправка.
test.setTimeout(90_000);

/** Свои компании у каждого проекта: БИН в базе уникален, проекты идут параллельно. */
const BASE: Record<string, number> = { 'phone-375': 60, 'desktop-1280': 80 };

let storePage: Page;
let supplierContext: BrowserContext;
let supplierPage: Page;
let base: number;

async function login(page: Page, phone: string) {
  await page.goto('/ru/login');
  await page.getByTestId('phone-input').fill(phone);
  await page.getByTestId('request-code').click();
  const code = await page.getByTestId('demo-code').textContent();
  await page.getByTestId('code-input').fill(code!);
  await page.getByTestId('verify-code').click();
  await page.waitForURL(/\/(onboarding|dashboard)$/);
}

async function createSupplier(page: Page, phone: string, bin: string, productIndex: number) {
  await login(page, phone);
  await page.getByTestId('type-SUPPLIER').click();
  await page.getByTestId('bin-input').fill(bin);
  await page.getByTestId('bin-check').click();
  await expect(page.getByTestId('bin-found')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Тараз' }).check();
  await page.getByTestId('consent-checkbox').check();
  await page.getByTestId('submit-company').click();
  await page.waitForURL(/\/dashboard$/);

  await open(page, '/ru/catalog');
  await page.waitForURL(/\/catalog$/);
  await page.getByTestId('catalog-file').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await buildCatalogXlsx([
      validRow(productIndex, { priceWithoutVat: '100.00', packSize: 1, minBatch: 2 }),
    ]),
  });
  await page.getByTestId('upload-catalog').click();
  await expect(page.getByTestId('import-created')).toHaveText('Добавлено товаров: 1');
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Подготовка тяжёлая: регистрации, каталоги и заявки.
  test.setTimeout(180_000);
  base = BASE[testInfo.project.name]!;

  // Три поставщика, каждый возит в Тараз и имеет один товар.
  for (let index = 0; index < 3; index += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await createSupplier(
      page,
      `+7707${String(base + index).padStart(7, '0')}`,
      testPoolBin(base + index),
      40000 + base * 10 + index,
    );
    if (index === 0) {
      supplierContext = context;
      supplierPage = page;
    } else {
      await context.close();
    }
  }

  storePage = await browser.newPage();
  await login(storePage, `+7708${String(base).padStart(7, '0')}`);
  await storePage.getByTestId('type-STORE').click();
  await storePage.getByTestId('bin-input').fill(testPoolBin(base + 5));
  await storePage.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await storePage.getByTestId('address-input').fill('ул. Демонстрационная, 3');
  await storePage.getByTestId('consent-checkbox').check();
  await storePage.getByTestId('submit-company').click();
  await storePage.waitForURL(/\/dashboard$/);
});

test.afterAll(async () => {
  await storePage.close();
  await supplierContext.close();
});

test('cart_with_three_suppliers_creates_three_orders_in_one_click', async () => {
  await open(storePage, '/ru/feed');
  await storePage.getByTestId('mode-list').click();

  // Берём по одному товару у каждого из трёх своих поставщиков.
  for (let index = 0; index < 3; index += 1) {
    const name = `Тестовый товар ${40000 + base * 10 + index}`;
    await storePage.getByTestId('feed-search').fill(name);
    await expect(storePage.getByTestId('list-table')).toContainText(name);
    await expect(storePage.getByTestId('list-table').getByRole('row')).toHaveCount(1);
    const input = storePage.getByTestId('list-table').getByRole('row').first().getByRole('textbox');
    await input.fill('2');
    await input.blur();
    await expect(input).toHaveValue('2.000');
  }

  await open(storePage, '/ru/cart');
  await expect(storePage.getByTestId('cart-suppliers-count')).toContainText('3 поставщика');

  await storePage.getByTestId('send-orders').click();
  await storePage.waitForURL(/\/orders$/, { timeout: 30_000 });

  await expect(storePage.getByTestId('orders-table').getByRole('row')).toHaveCount(3);
  await expect(storePage.getByTestId('notifications')).toBeHidden();
});

test('supplier_sees_incoming_order_and_notification', async () => {
  await open(supplierPage, '/ru/orders');

  await expect(supplierPage.getByTestId('orders-table').getByRole('row')).toHaveCount(1);
  await expect(supplierPage.getByTestId('notifications')).toContainText('Новая заявка');
});

test('supplier_confirms_order_partially_and_store_agrees', async () => {
  await supplierPage.getByRole('link', { name: 'Открыть' }).first().click();
  await supplierPage.waitForURL(/\/orders\/[^/]+$/);
  await expect(supplierPage.getByTestId('order-status')).toHaveText('Отправлена');

  const orderUrl = supplierPage.url();
  const orderNumber = (await supplierPage.getByTestId('order-number').textContent())!;

  // Подтверждаем 1 из 2 заказанных.
  const quantity = supplierPage.getByTestId('order-items').getByRole('textbox').first();
  await quantity.fill('1');
  await supplierPage.getByTestId('accept-partial').click();

  await expect(supplierPage.getByTestId('order-status')).toHaveText('Изменена поставщиком');
  await expect(supplierPage.getByTestId('order-total')).toHaveText('116');

  await open(storePage, '/ru/orders');
  await storePage.getByTestId(`order-open-${orderNumber}`).click();
  await expect(storePage.getByTestId('order-changed-notice')).toBeVisible();

  await storePage.getByTestId('agree-changes').click();
  await expect(storePage.getByTestId('order-status')).toHaveText('Принята');

  await open(supplierPage, orderUrl);
  await expect(supplierPage.getByTestId('order-status')).toHaveText('Принята');
});

test('order_walks_through_statuses_to_delivered', async () => {
  for (const status of ['Собирается', 'Отгружена', 'Доставлена']) {
    await supplierPage.getByTestId('next-status').click();
    await expect(supplierPage.getByTestId('order-status')).toHaveText(status);
  }

  await storePage.reload();
  await expect(storePage.getByTestId('order-status')).toHaveText('Доставлена');
  await expect(storePage.getByTestId('status-history')).toContainText('Отправлена');
  await expect(storePage.getByTestId('status-history')).toContainText('Доставлена');

  // Дальше магазин принимает товар приёмкой, а не сменой статуса: это D5.
  await expect(storePage.getByTestId('next-status')).toHaveCount(0);
});

test('store_cancels_order_with_reason', async () => {
  // Отменяем одну из двух оставшихся заявок (она в статусе «Отправлена»).
  await open(storePage, '/ru/orders');
  const rows = storePage.getByTestId('orders-table').getByRole('row');
  const sentRow = rows.filter({ hasText: 'Отправлена' }).first();
  await sentRow.getByRole('link', { name: 'Открыть' }).click();
  await storePage.waitForURL(/\/orders\/[^/]+$/);

  await storePage.getByTestId('cancel-reason').fill('магазин передумал');
  await storePage.getByTestId('cancel-order').click();
  await expect(storePage.getByTestId('order-status')).toHaveText('Отменена');
});

test('store_cannot_open_order_of_another_company', async () => {
  const foreign = await storePage.request.get('/api/orders/not-my-order-id');
  expect(foreign.status()).toBe(404);
});
