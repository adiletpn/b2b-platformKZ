import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { buildCatalogXlsx, validRow } from '../helpers/catalog-fixture';
import { testPoolBin } from '@/mocks/bin-registry';

/** Переписка двух сторон — логика, достаточно одного прогона. */
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const ONLY_PROJECT = 'desktop-1280';
const BASE = 420;

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
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'чат, один прогон');
  productName = `Тестовый товар ${130000 + BASE}`;

  supplierContext = await browser.newContext();
  supplierPage = await supplierContext.newPage();
  await login(supplierPage, `+7752${String(BASE).padStart(7, '0')}`);
  await supplierPage.getByTestId('type-SUPPLIER').click();
  await supplierPage.getByTestId('bin-input').fill(testPoolBin(BASE));
  await supplierPage.getByRole('checkbox', { name: 'Тараз' }).check();
  await supplierPage.getByTestId('consent-checkbox').check();
  await supplierPage.getByTestId('submit-company').click();
  await supplierPage.waitForURL(/\/dashboard$/);

  await supplierPage.goto('/ru/catalog');
  await supplierPage.getByTestId('catalog-file').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await buildCatalogXlsx([
      validRow(130000 + BASE, { priceWithoutVat: '100.00', packSize: 1, minBatch: 5 }),
    ]),
  });
  await supplierPage.getByTestId('upload-catalog').click();
  await expect(supplierPage.getByTestId('import-created')).toHaveText('Добавлено товаров: 1');

  storePage = await browser.newPage();
  await login(storePage, `+7753${String(BASE).padStart(7, '0')}`);
  await storePage.getByTestId('type-STORE').click();
  await storePage.getByTestId('bin-input').fill(testPoolBin(BASE + 1));
  await storePage.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await storePage.getByTestId('address-input').fill('ул. Демонстрационная, 21');
  await storePage.getByTestId('consent-checkbox').check();
  await storePage.getByTestId('submit-company').click();
  await storePage.waitForURL(/\/dashboard$/);

  // Заявка нужна, чтобы открыть чат по ней.
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
  await quantity.fill('5');
  await quantity.blur();
  await expect(quantity).toHaveValue('5.000');

  await storePage.goto('/ru/cart');
  await storePage.getByTestId('send-orders').click();
  await storePage.waitForURL(/\/orders$/, { timeout: 30_000 });
});

test.afterAll(async () => {
  await storePage?.close();
  await supplierContext?.close();
});

test('chat_is_empty_before_any_conversation', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'чат');

  await storePage.goto('/ru/chat');
  await expect(storePage.getByTestId('chat-empty')).toBeVisible();
});

test('store_opens_chat_from_order_and_writes_to_supplier', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'чат');

  await storePage.goto('/ru/orders');
  await storePage.getByRole('link', { name: 'Открыть' }).first().click();
  await storePage.waitForURL(/\/orders\/[^/]+$/);

  await storePage.getByTestId('open-order-chat').click();
  await storePage.waitForURL(/\/chat\?chat=/);

  await storePage.getByTestId('chat-input').fill('Когда планируете отгрузку?');
  await storePage.getByTestId('chat-send').click();

  await expect(storePage.getByTestId('chat-message-mine')).toContainText(
    'Когда планируете отгрузку?',
  );
  // Пока не прочитано — статус «Доставлено».
  await expect(storePage.getByTestId('chat-message-mine')).toContainText('Доставлено');
});

test('supplier_sees_unread_message_and_answers', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'чат');

  await supplierPage.goto('/ru/chat');
  await expect(supplierPage.getByTestId('chat-messages')).toContainText(
    'Когда планируете отгрузку?',
  );

  await supplierPage.getByTestId('chat-input').fill('Завтра до обеда');
  await supplierPage.getByTestId('chat-send').click();
  await expect(supplierPage.getByTestId('chat-message-mine')).toContainText('Завтра до обеда');
});

test('read_status_is_shown_to_the_author', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'чат');

  // Магазин открывает переписку — сообщение поставщика становится прочитанным.
  await storePage.goto('/ru/chat');
  await expect(storePage.getByTestId('chat-messages')).toContainText('Завтра до обеда');

  await supplierPage.goto('/ru/chat');
  await expect(supplierPage.getByTestId('chat-message-mine')).toContainText('Прочитано');
});

test('chat_is_not_accessible_without_rights', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'чат');

  // Чужая или несуществующая переписка: писать нельзя.
  const foreign = await supplierPage.request.post('/api/chats/not-a-chat/messages', {
    data: { text: 'привет' },
  });
  expect(foreign.status()).toBe(400);
  expect(await foreign.json()).toMatchObject({ status: 'not_found' });

  // Без сессии чат закрыт целиком.
  const anonymous = await browser.newContext();
  const response = await anonymous.request.get('/api/chats');
  expect(response.status()).toBe(401);
  await anonymous.close();
});
