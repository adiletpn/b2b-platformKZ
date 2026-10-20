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

/** Раздел 4.2 ТЗ: скидки, сдача, смешанная оплата, отложенный чек, внесение и X-отчёт. */
const BASE: Record<string, number> = { 'phone-375': 740, 'desktop-1280': 760 };

let pair: Pair;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const base = BASE[testInfo.project.name]!;
  pair = await registerPair(browser, {
    supplierPhone: `+7768${String(base).padStart(7, '0')}`,
    storePhone: `+7769${String(base).padStart(7, '0')}`,
    binIndex: base,
    productIndex: 140000 + base,
  });
  await bringOrderToPayment(pair, await orderWithDocuments(pair));
  const { storePage } = pair;
  await storePage.request.post('/api/stock/pricing', { data: { action: 'markup', percent: '30' } });
  await storePage.request.post('/api/stock/pricing', { data: { action: 'reprice' } });
  await storePage.goto('/ru/pos');
  await storePage.getByTestId('pos-cash').fill('1000');
  await storePage.getByTestId('open-shift').click();
  await expect(storePage.getByTestId('pos-shift')).toContainText('открыта');
});

test.afterAll(async () => {
  await pair?.storePage.context().close();
  await pair?.supplierPage.context().close();
});

test('cashier_sells_with_discount_and_gets_change', async () => {
  const { storePage } = pair;
  // Себестоимость 100 без НДС, наценка 30% — розничная цена 130.
  await storePage.getByTestId('pos-tile').first().click();
  await storePage.getByTestId('pos-tile').first().click();
  await storePage.getByTestId('pos-line-discount').fill('10');
  await expect(storePage.getByTestId('pos-total')).toHaveText('234.00 ₸');

  await storePage.getByTestId('pos-pay-CASH').click();
  await storePage.getByTestId('pos-cash-received').fill('300');
  await expect(storePage.getByTestId('pos-change')).toContainText('66.00');
  await storePage.getByTestId('pos-sell').click();
  await expect(storePage.getByTestId('pos-notice')).toContainText('Сдача: 66.00 ₸');
  await expectNoHorizontalScroll(storePage);
});

test('mixed_payment_splits_cash_and_card', async () => {
  const { storePage } = pair;
  await storePage.getByTestId('pos-tile').first().click();
  await storePage.getByTestId('pos-pay-MIXED').click();
  await storePage.getByTestId('pos-mixed-cash').fill('30');
  await expect(storePage.getByTestId('pos-mixed-card')).toContainText('100.00');
  await storePage.getByTestId('pos-sell').click();
  await expect(storePage.getByTestId('pos-notice')).toContainText('Чек пробит');
});

test('held_receipt_returns_to_cart', async () => {
  const { storePage } = pair;
  await storePage.getByTestId('pos-tile').first().click();
  await storePage.getByTestId('pos-hold').click();
  await expect(storePage.getByTestId('pos-cart')).toHaveCount(0);
  await storePage.getByTestId('pos-held').getByRole('button').first().click();
  await expect(storePage.getByTestId('pos-cart')).toBeVisible();
  await storePage.getByTestId('pos-clear').click();
});

test('cash_in_and_x_report_show_drawer', async () => {
  const { storePage } = pair;
  await storePage.getByTestId('pos-cash-in').click();
  await storePage.getByTestId('pos-cash-op-amount').fill('500');
  await storePage.getByTestId('pos-cash-op-reason').fill('размен');
  await storePage.getByTestId('pos-cash-op-submit').click();
  await expect(storePage.getByTestId('pos-notice')).toHaveText('Внесение записано в смену');

  await storePage.getByTestId('pos-x-report').click();
  const panel = storePage.getByTestId('pos-x-report-panel');
  // 1000 на начало + 234 + 30 наличными + 500 внесено.
  await expect(panel).toContainText('1764.00');
  await expect(panel).toContainText('Скидки');
  await expect(panel).toContainText('26.00');
});
