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

/** Раздел 3.6 ТЗ: экраны онлайн-оплаты и подписи ЭЦП на телефоне и на компьютере. */
const BASE: Record<string, number> = { 'phone-375': 600, 'desktop-1280': 620 };

let pair: Pair;
let orderPath: string;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const base = BASE[testInfo.project.name]!;
  pair = await registerPair(browser, {
    supplierPhone: `+7760${String(base).padStart(7, '0')}`,
    storePhone: `+7761${String(base).padStart(7, '0')}`,
    binIndex: base,
    productIndex: 140000 + base,
  });
  orderPath = await orderWithDocuments(pair);
});

test.afterAll(async () => {
  await pair?.storePage.context().close();
  await pair?.supplierPage.context().close();
});

test('supplier_signs_waybill_and_sees_who_and_when', async () => {
  const { supplierPage } = pair;
  const waybill = supplierPage.getByTestId('document-WAYBILL');

  await waybill.getByRole('button', { name: 'Подписать ЭЦП' }).click();
  await expect(waybill.getByTestId('signature-mark')).toContainText('Подписано ЭЦП');
  await expect(waybill.getByTestId('signature-mark')).toContainText(
    /\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/,
  );
  // Повторно подписать нельзя: кнопка исчезает.
  await expect(waybill.getByRole('button', { name: 'Подписать ЭЦП' })).toHaveCount(0);
  await expectNoHorizontalScroll(supplierPage);
});

test('store_signs_invoice_in_archive', async () => {
  const { storePage } = pair;
  await open(storePage, '/ru/archive');

  // Накладную уже подписал поставщик: отметка видна магазину.
  await expect(storePage.getByTestId('archive-table')).toContainText('ЭЦП:');
  const invoiceRow = storePage.getByTestId('archive-table').getByRole('row', { name: /Счёт/ });
  await invoiceRow.getByRole('button', { name: 'Подписать ЭЦП' }).click();
  await expect(invoiceRow.getByTestId('signature-mark')).toHaveCount(1);
  await expect(invoiceRow.getByRole('button', { name: 'Подписать ЭЦП' })).toHaveCount(0);
});

test('store_pays_order_online_by_link_and_qr', async () => {
  const { storePage } = pair;
  await bringOrderToPayment(pair, orderPath);

  const panel = storePage.getByTestId('online-payment');
  await panel.getByTestId('online-payment-provider').selectOption('halyk');
  await panel.getByTestId('online-payment-start').click();

  await expect(panel.getByTestId('online-payment-qr')).toBeVisible();
  await expect(panel.getByTestId('online-payment-link')).toHaveAttribute(
    'href',
    /^https:\/\/pay\.mock\.kz\/invoice\//,
  );
  // 5 штук по 116 ₸ с НДС 16%.
  await expect(panel.getByTestId('online-payment-amount')).toContainText('580');
  await expectNoHorizontalScroll(storePage);

  // Ссылка и QR сохраняются: после обновления страницы платёж тот же.
  const link = await panel.getByTestId('online-payment-link').getAttribute('href');
  await storePage.reload();
  await expect(storePage.getByTestId('online-payment-link')).toHaveAttribute('href', link!);

  await storePage.getByTestId('online-payment-mock-pay').click();
  await expect(storePage.getByTestId('order-status')).toHaveText('Оплачена');
  await expect(storePage.getByTestId('online-payment')).toHaveCount(0);
  await expect(storePage.getByTestId('order-payments')).toContainText('mock-');
});

test('gateway_callback_requires_signature', async () => {
  const { storePage } = pair;
  const response = await storePage.request.post('/api/payments/callback', {
    data: { externalId: 'mock-forged', paid: true },
  });
  expect(response.status()).toBe(401);
});
