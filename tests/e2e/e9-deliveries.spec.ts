import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  orderWithDocuments,
  registerPair,
  type Pair,
} from '../helpers/e2e-flow';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** Разделы 1.2 и 3.5 ТЗ: водитель видит доставку, открывает накладную, отмечает доставку. */
const BASE: Record<string, number> = { 'phone-375': 780, 'desktop-1280': 800 };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let pair: Pair;
let orderPath: string;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const base = BASE[testInfo.project.name]!;
  pair = await registerPair(browser, {
    supplierPhone: `+7756${String(base).padStart(7, '0')}`,
    storePhone: `+7757${String(base).padStart(7, '0')}`,
    binIndex: base,
    productIndex: 140000 + base,
  });
  orderPath = await orderWithDocuments(pair);
  const { supplierPage } = pair;
  for (const status of ['Собирается', 'Отгружена']) {
    await supplierPage.getByTestId('next-status').click();
    await expect(supplierPage.getByTestId('order-status')).toHaveText(status);
  }
});

test.afterAll(async () => {
  await pair?.storePage.context().close();
  await pair?.supplierPage.context().close();
});

test('driver_delivers_order_with_photo_of_signed_waybill', async () => {
  const { supplierPage, storePage } = pair;
  await supplierPage.getByTestId('go-deliveries').click();
  await supplierPage.waitForURL(/\/deliveries$/);

  const card = supplierPage.getByTestId('deliveries-list').locator('li').first();
  await expect(card.getByTestId('delivery-status')).toHaveText('Отгружена');
  await expect(card).toContainText('Демонстрационная, 12');
  const waybill = await supplierPage.request.get(
    (await card.getByTestId('delivery-waybill').getAttribute('href'))!,
  );
  expect(waybill.headers()['content-type']).toBe('application/pdf');
  await expectNoHorizontalScroll(supplierPage);

  await card.getByTestId('delivery-photo-input').setInputFiles({
    name: 'подпись.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(card.getByTestId('delivery-message')).toHaveText('Фото сохранено в заявке');
  await card.getByTestId('delivery-done').click();
  await expect(card.getByTestId('delivery-status')).toHaveText('Доставлена');

  // Магазин видит фото подписанной накладной в своей заявке.
  await storePage.goto(orderPath);
  await expect(storePage.getByTestId('order-files').getByTestId('file-link')).toHaveText(
    'подпись.png',
  );
});
