import { open } from '../helpers/open';
import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  orderWithDocuments,
  registerPair,
  type Pair,
} from '../helpers/e2e-flow';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

/** Раздел 4.3 ТЗ: версии документов и свои файлы заявки и компании. */
const BASE: Record<string, number> = { 'phone-375': 640, 'desktop-1280': 660 };

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

let pair: Pair;
let orderPath: string;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const base = BASE[testInfo.project.name]!;
  pair = await registerPair(browser, {
    supplierPhone: `+7762${String(base).padStart(7, '0')}`,
    storePhone: `+7763${String(base).padStart(7, '0')}`,
    binIndex: base,
    productIndex: 140000 + base,
  });
  orderPath = await orderWithDocuments(pair);
});

test.afterAll(async () => {
  await pair?.storePage.context().close();
  await pair?.supplierPage.context().close();
});

test('supplier_corrects_invoice_and_old_version_stays_in_history', async () => {
  const { supplierPage } = pair;
  const invoice = supplierPage.getByTestId('document-INVOICE');

  await invoice.getByRole('button', { name: 'Исправить' }).click();
  await invoice.getByTestId('correction-reason').fill('Уточнён адрес доставки');
  await invoice.getByTestId('correction-address').fill('Тараз, ул. Исправленная, 1');
  await invoice.getByTestId('correction-submit').click();

  await expect(invoice.getByTestId('document-version')).toContainText('Версия 2');
  await expect(invoice.getByTestId('document-version')).toContainText('Уточнён адрес доставки');
  await invoice.getByTestId('version-history').locator('summary').click();
  const oldPdf = invoice.getByTestId('version-pdf-1');
  await expect(oldPdf).toBeVisible();

  const response = await supplierPage.request.get((await oldPdf.getAttribute('href'))!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('application/pdf');
  await expectNoHorizontalScroll(supplierPage);
});

test('store_sees_correction_but_cannot_correct_incoming_document', async () => {
  const { storePage } = pair;
  await open(storePage, orderPath);
  const invoice = storePage.getByTestId('document-INVOICE');

  await expect(invoice.getByTestId('document-version')).toContainText('Версия 2');
  // Исправляет только выписавшая сторона.
  await expect(invoice.getByRole('button', { name: 'Исправить' })).toHaveCount(0);

  await open(storePage, '/ru/orders');
  await expect(storePage.getByTestId('notifications')).toContainText('исправлен, версия 2');
  await open(storePage, orderPath);
});

test('store_attaches_photo_and_supplier_downloads_it', async () => {
  const { storePage, supplierPage } = pair;
  const files = storePage.getByTestId('order-files');

  await files.getByTestId('file-kind').selectOption('PHOTO');
  await files.getByTestId('file-input').setInputFiles({
    name: 'накладная-фото.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  await files.getByTestId('file-upload').click();
  await expect(files.getByTestId('file-link')).toHaveText('накладная-фото.png');
  await expectNoHorizontalScroll(storePage);

  await supplierPage.reload();
  const link = supplierPage.getByTestId('order-files').getByTestId('file-link');
  await expect(link).toHaveText('накладная-фото.png');
  // Поставщик видит файл, но удалить чужой не может.
  await expect(supplierPage.getByTestId('order-files').getByTestId('file-delete')).toHaveCount(0);
  const download = await supplierPage.request.get((await link.getAttribute('href'))!);
  expect(download.headers()['content-type']).toBe('image/png');
  expect(Buffer.from(await download.body())).toEqual(PNG);
});

test('html_disguised_as_pdf_is_refused', async () => {
  const { storePage } = pair;
  const files = storePage.getByTestId('order-files');

  await files.getByTestId('file-input').setInputFiles({
    name: 'счёт.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('<html><script>alert(1)</script></html>'),
  });
  await files.getByTestId('file-upload').click();
  await expect(files.getByTestId('file-error')).toHaveText('Такой тип файла не поддерживается');
});

test('company_keeps_contract_in_archive', async () => {
  const { storePage, supplierPage } = pair;
  await open(storePage, '/ru/archive');
  await expect(storePage.getByTestId('archive-version')).toHaveText('версия 2');

  const files = storePage.getByTestId('company-files');
  await files.getByTestId('file-kind').selectOption('CONTRACT');
  await files.getByTestId('file-input').setInputFiles({
    name: 'договор-поставки.pdf',
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await files.getByTestId('file-upload').click();
  await expect(files.getByTestId('file-link')).toHaveText('договор-поставки.pdf');
  await expectNoHorizontalScroll(storePage);

  // Файл компании не виден контрагенту.
  await open(supplierPage, '/ru/archive');
  await expect(supplierPage.getByTestId('company-files')).not.toContainText('договор-поставки');

  await files.getByTestId('file-delete').click();
  await expect(files.getByTestId('files-empty')).toBeVisible();
});
