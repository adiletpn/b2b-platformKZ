import { expect, test } from '@playwright/test';
import {
  bringOrderToPayment,
  expectNoHorizontalScroll,
  orderWithDocuments,
  registerPair,
  type Pair,
} from '../helpers/e2e-flow';
import { createTestPrisma } from '../helpers/test-db';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** Раздел 4.4 ТЗ: архив за период, выгрузки в 1С и CSV, QR проверки документа. */
const BASE: Record<string, number> = { 'phone-375': 680, 'desktop-1280': 700 };

let pair: Pair;
let orderPath: string;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const base = BASE[testInfo.project.name]!;
  pair = await registerPair(browser, {
    supplierPhone: `+7764${String(base).padStart(7, '0')}`,
    storePhone: `+7765${String(base).padStart(7, '0')}`,
    binIndex: base,
    productIndex: 140000 + base,
  });
  orderPath = await orderWithDocuments(pair);
  await bringOrderToPayment(pair, orderPath);
});

test.afterAll(async () => {
  await pair?.storePage.context().close();
  await pair?.supplierPage.context().close();
});

test('supplier_downloads_documents_of_period_as_zip', async () => {
  const { supplierPage } = pair;
  await supplierPage.goto('/ru/archive');
  const panel = supplierPage.getByTestId('exports-panel');
  await expectNoHorizontalScroll(supplierPage);

  const downloading = supplierPage.waitForEvent('download');
  await panel.getByTestId('export-bundle').click();
  const download = await downloading;
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const zip = readFileSync(path!);
  // Сигнатура ZIP и кириллические имена папок в UTF-8.
  expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  expect(zip.includes(Buffer.from('Накладная З-2/', 'utf8'))).toBe(true);

  // Период без документов — понятная ошибка, а не пустой архив.
  await panel.getByTestId('export-from').fill('2020-01-01');
  await panel.getByTestId('export-to').fill('2020-01-31');
  await panel.getByTestId('export-bundle').click();
  await expect(panel.getByTestId('export-error')).toHaveText('За период документов нет');
});

test('one_c_and_csv_exports_are_downloaded', async () => {
  const { supplierPage, storePage } = pair;
  const sales = await supplierPage.request.get('/api/exports/one-c?kind=sales');
  expect(sales.status()).toBe(200);
  expect(await sales.text()).toContain('<ХозОперация>Отпуск товара</ХозОперация>');

  const catalog = await supplierPage.request.get('/api/exports/csv/catalog');
  expect(await catalog.text()).toContain(pair.productName);

  await storePage.goto('/ru/archive');
  // Магазину CSV каталога не нужен, остатков — нужен.
  await expect(storePage.getByTestId('export-csv-catalog')).toHaveCount(0);
  const href = await storePage.getByTestId('export-csv-stock').getAttribute('href');
  const stock = await storePage.request.get(href!);
  expect(stock.headers()['content-type']).toContain('text/csv');
  expect(await stock.text()).toContain('5.000');

  const counterparties = await storePage.request.get('/api/exports/one-c?kind=counterparties');
  expect(await counterparties.text()).toContain('<Роль>Поставщик</Роль>');
});

test('anyone_with_qr_checks_document_without_login', async ({ browser }) => {
  const prisma = createTestPrisma();
  const invoice = await prisma.document.findFirstOrThrow({
    where: { order: { id: orderPath.split('/').pop()! }, type: 'INVOICE' },
  });
  await prisma.$disconnect();

  const anonymous = await browser.newContext();
  const page = await anonymous.newPage();
  await page.goto(`/ru/verify/${invoice.verificationCode}?v=1`);
  await expect(page.getByTestId('verify-status')).toHaveText(
    'Документ найден, версия на бумаге актуальна',
  );
  await expect(page.getByTestId('verify-result')).toContainText(invoice.number);
  await expect(page.getByTestId('verify-result')).toContainText('••••••');
  await expectNoHorizontalScroll(page);

  await page.goto('/kk/verify/00000000-0000-0000-0000-000000000000');
  await expect(page.getByTestId('verify-not-found')).toContainText('Құжат табылмады');
  await anonymous.close();
});
