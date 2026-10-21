import { expect, type Browser, type Page } from '@playwright/test';
import { buildCatalogXlsx, validRow } from './catalog-fixture';
import { testPoolBin } from '@/mocks/bin-registry';
import { open } from './open';

/**
 * Общие шаги e2e этапа 2: регистрация пары «поставщик — магазин» и проводка заявки
 * через интерфейс до нужного статуса. Номера телефонов и БИН задаёт спека,
 * чтобы прогоны разных файлов не пересекались в общей тестовой базе.
 */
export async function login(page: Page, phone: string) {
  await page.goto('/ru/login');
  await page.getByTestId('phone-input').fill(phone);
  await page.getByTestId('request-code').click();
  const code = await page.getByTestId('demo-code').textContent();
  await page.getByTestId('code-input').fill(code!);
  await page.getByTestId('verify-code').click();
  await page.waitForURL(/\/(onboarding|dashboard)$/);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

export type Pair = { supplierPage: Page; storePage: Page; productName: string };

/** Поставщик с одним товаром и магазин в Таразе. */
export async function registerPair(
  browser: Browser,
  options: { supplierPhone: string; storePhone: string; binIndex: number; productIndex: number },
): Promise<Pair> {
  const productName = `Тестовый товар ${options.productIndex}`;

  const supplierPage = await (await browser.newContext()).newPage();
  await login(supplierPage, options.supplierPhone);
  await supplierPage.getByTestId('type-SUPPLIER').click();
  await supplierPage.getByTestId('bin-input').fill(testPoolBin(options.binIndex));
  await supplierPage.getByRole('checkbox', { name: 'Тараз' }).check();
  await supplierPage.getByTestId('consent-checkbox').check();
  await supplierPage.getByTestId('submit-company').click();
  await supplierPage.waitForURL(/\/dashboard$/);

  await open(supplierPage, '/ru/catalog');
  await supplierPage.getByTestId('catalog-file').setInputFiles({
    name: 'catalog.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: await buildCatalogXlsx([
      validRow(options.productIndex, { priceWithoutVat: '100.00', packSize: 1, minBatch: 5 }),
    ]),
  });
  await supplierPage.getByTestId('upload-catalog').click();
  await expect(supplierPage.getByTestId('import-created')).toHaveText('Добавлено товаров: 1');

  const storePage = await (await browser.newContext()).newPage();
  await login(storePage, options.storePhone);
  await storePage.getByTestId('type-STORE').click();
  await storePage.getByTestId('bin-input').fill(testPoolBin(options.binIndex + 1));
  await storePage.getByTestId('city-select').selectOption({ label: 'Тараз' });
  await storePage.getByTestId('address-input').fill('ул. Демонстрационная, 12');
  await storePage.getByTestId('consent-checkbox').check();
  await storePage.getByTestId('submit-company').click();
  await storePage.waitForURL(/\/dashboard$/);

  return { supplierPage, storePage, productName };
}

/** Заявка от магазина, принятая поставщиком, с накладной и счётом. Возвращает путь карточки. */
export async function orderWithDocuments(pair: Pair): Promise<string> {
  const { storePage, supplierPage, productName } = pair;
  await open(storePage, '/ru/feed');
  await storePage.getByTestId('mode-list').click();
  await storePage.getByTestId('feed-search').fill(productName);
  await expect(storePage.getByTestId('list-table')).toContainText(productName);
  // Строка ищется по названию: до срабатывания поиска в таблице видны и чужие товары.
  const quantity = storePage
    .getByTestId('list-table')
    .getByRole('row')
    .filter({ hasText: productName })
    .getByRole('textbox');
  await quantity.fill('5');
  await quantity.blur();
  await expect(quantity).toHaveValue('5.000');

  await open(storePage, '/ru/cart');
  await storePage.getByTestId('send-orders').click();
  await storePage.waitForURL(/\/orders$/, { timeout: 30_000 });

  await open(supplierPage, '/ru/orders');
  await supplierPage.getByRole('link', { name: 'Открыть' }).first().click();
  await supplierPage.waitForURL(/\/orders\/[^/]+$/);
  await supplierPage.getByTestId('accept-full').click();
  await supplierPage.getByTestId('create-documents').click();
  await expect(supplierPage.getByTestId('document-INVOICE')).toBeVisible();
  return new URL(supplierPage.url()).pathname;
}

/** Доставка, приёмка без расхождений и выставление к оплате. */
export async function bringOrderToPayment(pair: Pair, orderPath: string) {
  const { storePage, supplierPage } = pair;
  await open(supplierPage, orderPath);
  for (const status of ['Собирается', 'Отгружена', 'Доставлена']) {
    await supplierPage.getByTestId('next-status').click();
    await expect(supplierPage.getByTestId('order-status')).toHaveText(status);
  }

  await open(storePage, orderPath);
  await storePage.getByTestId('submit-acceptance').click();
  await expect(storePage.getByTestId('acceptance-result')).toBeVisible();
  await storePage.reload();
  await storePage.getByTestId('to-payment').click();
  await expect(storePage.getByTestId('order-status')).toHaveText('Ожидает оплаты');
}
