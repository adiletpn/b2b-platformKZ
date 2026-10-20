import { expect, test, type Page } from '@playwright/test';
import { orderWithDocuments, registerPair, type Pair } from '../helpers/e2e-flow';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** Разделы 3.7 и 3.13 ТЗ: чат с шаблонами и жалобой, поддержка, блокировка пользователя. */
const ONLY_PROJECT = 'desktop-1280';
const BASE = 820;
const STORE_PHONE = `+7759${String(BASE).padStart(7, '0')}`;

let pair: Pair;
let adminPage: Page;

async function adminLogin(page: Page) {
  await page.goto('/ru/admin');
  await page.getByTestId('admin-phone').fill('+77009000001');
  await page.getByTestId('admin-request-code').click();
  const code = await page.getByTestId('admin-demo-code').textContent();
  await page.getByTestId('admin-code').fill(code!);
  await page.getByTestId('admin-enter').click();
  await expect(page.getByTestId('admin-role')).toBeVisible();
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'операции платформы, один прогон');
  pair = await registerPair(browser, {
    supplierPhone: `+7758${String(BASE).padStart(7, '0')}`,
    storePhone: STORE_PHONE,
    binIndex: BASE,
    productIndex: 140000 + BASE,
  });
  await orderWithDocuments(pair);
  adminPage = await (await browser.newContext()).newPage();
  await adminLogin(adminPage);
});

test.afterAll(async () => {
  await pair?.storePage.context().close();
  await pair?.supplierPage.context().close();
  await adminPage?.context().close();
});

test('supplier_answers_with_template_and_store_complains', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'один прогон');
  const { supplierPage, storePage } = pair;

  await supplierPage.getByTestId('open-order-chat').click();
  await supplierPage.waitForURL(/\/chat/);
  await supplierPage.getByTestId('chat-input').fill('Привезём завтра до обеда');
  await supplierPage.getByTestId('chat-save-template').click();
  await expect(supplierPage.getByTestId('chat-notice')).toHaveText('Шаблон ответа сохранён');
  await supplierPage.getByTestId('chat-input').fill('');
  await supplierPage.getByTestId('chat-template').first().click();
  await expect(supplierPage.getByTestId('chat-input')).toHaveValue('Привезём завтра до обеда');
  await supplierPage.getByTestId('chat-send').click();
  await expect(supplierPage.getByTestId('chat-message-mine')).toHaveCount(1);

  await storePage.goto('/ru/chat');
  await storePage.getByTestId('chat-search').fill('обеда');
  await expect(storePage.getByTestId('chat-search-results')).toContainText('Привезём завтра');
  await storePage.getByTestId('chat-search').fill('');
  await storePage.getByTestId('chat-complain').first().click();
  await storePage.getByTestId('chat-complaint-reason').fill('Нарушает договорённость');
  await storePage.getByTestId('chat-complaint-send').click();
  await expect(storePage.getByTestId('chat-notice')).toHaveText(
    'Жалоба отправлена модератору платформы',
  );

  await adminPage.reload();
  await expect(adminPage.getByTestId('complaints-panel')).toContainText('Нарушает договорённость');
});

test('store_asks_support_and_gets_answer', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'один прогон');
  const { storePage } = pair;

  await storePage.getByTestId('go-support').click();
  await storePage.getByTestId('support-subject').fill('Как подключить Kaspi');
  await storePage.getByTestId('support-text').fill('Подскажите, где ввести ключ');
  await storePage.getByTestId('support-create').click();
  await expect(storePage.getByTestId('support-status')).toHaveText('Открыто');

  await adminPage.reload();
  await adminPage.getByTestId('admin-ticket').filter({ hasText: 'Как подключить Kaspi' }).click();
  await adminPage.getByTestId('admin-ticket-reply').fill('Ключ задаёт администратор платформы');
  await adminPage.getByTestId('admin-ticket-send').click();
  await expect(adminPage.getByTestId('admin-ticket-thread')).toContainText('Ключ задаёт');

  await storePage.reload();
  await storePage.getByTestId('support-list').getByRole('button').first().click();
  await expect(storePage.getByTestId('support-answer')).toContainText('Ключ задаёт администратор');
});

test('blocked_user_loses_access_and_cannot_log_in', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'один прогон');
  const { storePage } = pair;

  await adminPage.getByTestId('admin-users-query').fill(STORE_PHONE);
  await adminPage.getByTestId('admin-users-find').click();
  await adminPage.getByTestId('admin-user-reason').fill('Проверка блокировки');
  await adminPage.getByTestId('admin-user-block').click();
  await expect(adminPage.getByTestId('admin-users-message')).toHaveText(
    'Пользователь заблокирован',
  );

  await storePage.goto('/ru/dashboard');
  await expect(storePage).toHaveURL(/\/login$/);
  await storePage.getByTestId('phone-input').fill(STORE_PHONE);
  await storePage.getByTestId('request-code').click();
  const code = await storePage.getByTestId('demo-code').textContent();
  await storePage.getByTestId('code-input').fill(code!);
  await storePage.getByTestId('verify-code').click();
  await expect(storePage.getByTestId('auth-error')).toContainText('заблокирован');
});
