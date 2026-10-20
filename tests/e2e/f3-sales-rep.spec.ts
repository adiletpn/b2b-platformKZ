import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  login,
  orderWithDocuments,
  registerPair,
  type Pair,
} from '../helpers/e2e-flow';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** Этап 3 ТЗ: Владелец закрепляет магазин за торговым представителем, тот видит только его. */
const BASE: Record<string, number> = { 'phone-375': 500, 'desktop-1280': 510 };

let pair: Pair;
let repPage: Page;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const base = BASE[testInfo.project.name]!;
  pair = await registerPair(browser, {
    supplierPhone: `+7774${String(base).padStart(7, '0')}`,
    storePhone: `+7775${String(base).padStart(7, '0')}`,
    binIndex: base,
    productIndex: 160000 + base,
  });
  await orderWithDocuments(pair);

  const repPhone = `+7776${String(base).padStart(7, '0')}`;
  const invited = await pair.supplierPage.request.post('/api/employees', {
    data: { phone: repPhone, role: 'SALES_REP' },
  });
  expect(invited.ok()).toBe(true);
  repPage = await (await browser.newContext()).newPage();
  await login(repPage, repPhone);
});

test.afterAll(async () => {
  await repPage?.context().close();
  await pair?.storePage.context().close();
  await pair?.supplierPage.context().close();
});

test('rep_has_no_stores_and_no_orders_before_assignment', async () => {
  await repPage.goto('/ru/reps');
  await expect(repPage.getByTestId('reps-empty')).toBeVisible();
  // Все заявки компании представителю не открыты ни в интерфейсе, ни через API.
  expect((await repPage.request.get('/api/orders')).status()).toBe(403);
  await repPage.goto('/ru/orders');
  await repPage.waitForURL(/\/dashboard$/);
});

test('owner_assigns_store_and_rep_marks_visit', async () => {
  const { supplierPage } = pair;
  await supplierPage.getByTestId('go-reps').click();
  await supplierPage.waitForURL(/\/reps$/);
  await supplierPage.getByTestId('reps-assign').click();
  await expect(supplierPage.getByTestId('reps-message')).toHaveText('Магазин закреплён');
  await expect(supplierPage.getByTestId('reps-assignments')).toContainText('Тест-магазин');
  await expectNoHorizontalScroll(supplierPage);

  await repPage.goto('/ru/reps');
  const card = repPage.getByTestId('reps-store-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId('reps-orders')).toContainText('ЗАК-');
  await expect(card.getByTestId('reps-debt')).toContainText('0.00 ₸');

  await card.getByTestId('reps-visit-comment').fill('Обсудили новую акцию');
  await card.getByTestId('reps-visit').click();
  await expect(repPage.getByTestId('reps-message')).toHaveText('Визит отмечен');
  await expect(card.getByTestId('reps-visits')).toContainText('Обсудили новую акцию');
  await expectNoHorizontalScroll(repPage);

  // Закреплять магазины представитель сам не может.
  const forbidden = await repPage.request.post('/api/reps', {
    data: { action: 'unassign', storeId: 'any' },
  });
  expect(forbidden.status()).toBe(403);
});
