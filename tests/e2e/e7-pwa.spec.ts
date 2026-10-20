import { expect, test } from '@playwright/test';
import {
  bringOrderToPayment,
  orderWithDocuments,
  registerPair,
  type Pair,
} from '../helpers/e2e-flow';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/**
 * Раздел 6 ТЗ, этап 2: PWA — касса открывается без сети. Service worker и кэш
 * от ширины экрана не зависят, поэтому сценарий гоняется в одном проекте.
 */
const ONLY_PROJECT = 'desktop-1280';
const BASE = 720;

let pair: Pair;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'PWA, один прогон');
  pair = await registerPair(browser, {
    supplierPhone: `+7766${String(BASE).padStart(7, '0')}`,
    storePhone: `+7767${String(BASE).padStart(7, '0')}`,
    binIndex: BASE,
    productIndex: 140000 + BASE,
  });
  // Товар приходует приёмка, розничную цену ставит переоценка с наценкой.
  await bringOrderToPayment(pair, await orderWithDocuments(pair));
  const { storePage } = pair;
  await storePage.request.post('/api/stock/pricing', { data: { action: 'markup', percent: '30' } });
  await storePage.request.post('/api/stock/pricing', { data: { action: 'reprice' } });
});

test.afterAll(async () => {
  await pair?.storePage.context().close();
  await pair?.supplierPage.context().close();
});

test('app_has_manifest_for_installation', async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'PWA, один прогон');
  const response = await request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  const manifest = (await response.json()) as { display: string; icons: { sizes: string }[] };
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.map((icon) => icon.sizes)).toContain('512x512');
  expect((await request.get('/icons/icon-192.png')).headers()['content-type']).toBe('image/png');
});

test('cashier_opens_pos_and_sells_without_network', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'PWA, один прогон');
  const { storePage, productName } = pair;

  await storePage.goto('/ru/pos');
  await storePage.getByTestId('pos-cash').fill('1000');
  await storePage.getByTestId('open-shift').click();
  await expect(storePage.getByTestId('pos-shift')).toContainText('открыта');

  // Ждём, пока service worker возьмёт страницу под контроль и сохранит кассу.
  await storePage.evaluate(() => navigator.serviceWorker.ready);
  await storePage.reload();
  await expect
    .poll(() => storePage.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expect
    .poll(() => storePage.evaluate(async () => Boolean(await caches.match('/ru/pos'))))
    .toBe(true);

  // Связи нет: касса открывается из кэша вместе с товарами и продаёт в очередь.
  await storePage.context().setOffline(true);
  await storePage.reload();
  await expect(storePage.getByTestId('pos-shift')).toContainText('открыта');
  const option = storePage.getByTestId('pos-product').locator('option', { hasText: productName });
  await storePage.getByTestId('pos-product').selectOption((await option.getAttribute('value'))!);
  await storePage.getByTestId('pos-sell').click();
  await expect(storePage.getByTestId('pos-queued')).toHaveText('Ждут отправки: 1');

  // Связь вернулась: чек уходит на сервер без дублей.
  await storePage.context().setOffline(false);
  await expect(storePage.getByTestId('pos-queued')).toHaveCount(0, { timeout: 15_000 });
  const shift = await storePage.request.get('/api/pos/shift');
  expect(JSON.stringify(await shift.json())).toContain('"receipts":1');
});

test('logout_removes_cached_pos_page', async ({}, testInfo) => {
  test.skip(testInfo.project.name !== ONLY_PROJECT, 'PWA, один прогон');
  const { storePage } = pair;

  await storePage.getByTestId('logout').click();
  await storePage.waitForURL(/\/login$/);
  expect(await storePage.evaluate(async () => Boolean(await caches.match('/ru/pos')))).toBe(false);
});
