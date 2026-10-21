import { open } from '../helpers/open';
import { expect, test } from '@playwright/test';
import {
  bringOrderToPayment,
  expectNoHorizontalScroll,
  orderWithDocuments,
  registerPair,
  type Pair,
} from '../helpers/e2e-flow';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** Этап 3 ТЗ: бонусы покупателя по телефону — начисление, списание, Z-отчёт. */
const BASE: Record<string, number> = { 'phone-375': 460, 'desktop-1280': 480 };
const BUYER = (base: number) => `+7701${String(base).padStart(7, '0')}`;

let pair: Pair;
let base: number;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  base = BASE[testInfo.project.name]!;
  pair = await registerPair(browser, {
    supplierPhone: `+7772${String(base).padStart(7, '0')}`,
    storePhone: `+7773${String(base).padStart(7, '0')}`,
    binIndex: base,
    productIndex: 150000 + base,
  });
  await bringOrderToPayment(pair, await orderWithDocuments(pair));
  const { storePage } = pair;
  await storePage.request.post('/api/stock/pricing', { data: { action: 'markup', percent: '30' } });
  await storePage.request.post('/api/stock/pricing', { data: { action: 'reprice' } });
  await open(storePage, '/ru/pos');
  await storePage.getByTestId('open-shift').click();
  await expect(storePage.getByTestId('pos-shift')).toContainText('открыта');
});

test.afterAll(async () => {
  await pair?.storePage.context().close();
  await pair?.supplierPage.context().close();
});

test('receipt_with_phone_earns_bonus', async () => {
  const { storePage } = pair;
  await storePage.getByTestId('pos-tile').first().click();
  await storePage.getByTestId('pos-customer-phone').fill(BUYER(base));
  await storePage.getByTestId('pos-pay-CARD').click();
  await storePage.getByTestId('pos-sell').click();
  // 130 × 5% = 6.50 бонусами.
  await expect(storePage.getByTestId('pos-notice')).toContainText('Начислено бонусов: 6,50 ₸');
  await expectNoHorizontalScroll(storePage);
});

test('next_receipt_redeems_bonus_and_report_shows_it', async () => {
  const { storePage } = pair;
  await storePage.getByTestId('pos-tile').first().click();
  await storePage.getByTestId('pos-customer-phone').fill(BUYER(base));
  await storePage.getByTestId('pos-customer-find').click();
  await expect(storePage.getByTestId('pos-customer-balance')).toContainText('6,50 ₸');
  // Номер покупателя на экране — маской.
  await expect(storePage.getByTestId('pos-customer-balance')).not.toContainText(BUYER(base));

  await storePage.getByTestId('pos-bonus-redeem').fill('6.50');
  await expect(storePage.getByTestId('pos-total')).toHaveText('123,50 ₸');
  await storePage.getByTestId('pos-pay-CARD').click();
  await storePage.getByTestId('pos-sell').click();
  await expect(storePage.getByTestId('pos-notice')).toContainText('Чек пробит');

  await storePage.getByTestId('pos-x-report').click();
  const panel = storePage.getByTestId('pos-x-report-panel');
  await expect(panel).toContainText('Бонусами');
  await expect(panel).toContainText('6,50 ₸');

  // Печатный чек показывает оплату бонусами и сумму к оплате.
  const receiptUrl = await storePage.getByTestId('pos-print').getAttribute('href');
  await storePage.goto(receiptUrl!);
  await expect(storePage.getByTestId('receipt-bonus')).toContainText('6.50');
  await open(storePage, '/ru/pos');
});

test('analytics_shows_sales_of_the_period', async () => {
  const { storePage } = pair;
  await open(storePage, '/ru/analytics');
  await storePage.waitForURL(/\/analytics$/);
  // Два чека по 130: выручка 260, прибыль 2 × 30.
  await expect(storePage.getByTestId('analytics-store')).toContainText('260 ₸');
  await expect(storePage.getByTestId('analytics-chart')).toBeVisible();
  await expect(storePage.getByTestId('analytics-abc')).toContainText('A');
  const file = await storePage.request.get(
    (await storePage.getByTestId('analytics-xlsx').getAttribute('href'))!,
  );
  expect(file.status()).toBe(200);
  await expectNoHorizontalScroll(storePage);
});
