import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createTestPrisma, resetTransactionalData } from '../helpers/test-db';
import { buildCatalogXlsx, toArrayBuffer, validRow } from '../helpers/catalog-fixture';
import { registerCompany } from '@/lib/registration/register-company';
import { importCatalog } from '@/lib/catalog/import';
import { recordSwipe } from '@/lib/feed/swipe';
import { checkout } from '@/lib/orders/checkout';
import { confirmOrder } from '@/lib/orders/workflow';
import { createWaybillAndInvoice } from '@/lib/documents/create';
import { correctDocument, documentForPrint, listDocumentVersions } from '@/lib/documents/versions';
import { getSignatures, signDocumentByCompany } from '@/lib/documents/signature';
import { searchDocuments } from '@/lib/archive/search';
import {
  deleteAttachment,
  detectFileType,
  listAttachments,
  readAttachment,
  safeFileName,
  uploadAttachment,
} from '@/lib/files/attachments';
import { testPoolBin } from '@/mocks/bin-registry';
import { documentXlsx } from '@/lib/documents/xlsx';
import { LABELS } from '@/lib/documents/templates';

const prisma = createTestPrisma();

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF = new TextEncoder().encode('%PDF-1.7\n%тест\n');
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');
const ZIP = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0]);

/** Заявка с накладной и счётом; поставщик выписал документы, магазин — получатель. */
async function orderWithDocuments(index: number) {
  const supplierUser = await prisma.user.create({
    data: { phone: `+7785${String(index).padStart(7, '0')}` },
  });
  const storeUser = await prisma.user.create({
    data: { phone: `+7786${String(index).padStart(7, '0')}` },
  });
  const taraz = await prisma.city.findUniqueOrThrow({ where: { code: 'taraz' } });

  const supplier = await registerCompany({
    userId: supplierUser.id,
    bin: testPoolBin(600 + index * 2),
    type: 'SUPPLIER',
    deliveryCityIds: [taraz.id],
    consentAccepted: true,
  });
  const store = await registerCompany({
    userId: storeUser.id,
    bin: testPoolBin(601 + index * 2),
    type: 'STORE',
    location: { cityId: taraz.id, address: 'ул. Демонстрационная, 77' },
    consentAccepted: true,
  });
  if (supplier.status !== 'created' || store.status !== 'created') throw new Error('регистрация');

  await importCatalog(
    supplier.companyId,
    toArrayBuffer(
      await buildCatalogXlsx([
        validRow(250000 + index, { priceWithoutVat: '100.00', packSize: 1, minBatch: 3 }),
      ]),
    ),
  );
  const location = await prisma.location.findFirstOrThrow({
    where: { companyId: store.companyId },
  });
  const offer = await prisma.supplierOffer.findFirstOrThrow({
    where: { supplierId: supplier.companyId },
  });
  await recordSwipe(store.companyId, location.id, offer.id, 'LIKE');
  const created = await checkout({
    storeId: store.companyId,
    locationId: location.id,
    cityId: taraz.id,
    userId: storeUser.id,
  });
  if (created.status !== 'created') throw new Error(created.status);
  const orderId = created.orders[0]!.id;
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: true },
  });
  await confirmOrder(
    orderId,
    supplier.companyId,
    supplierUser.id,
    order.items.map((item) => ({
      orderItemId: item.id,
      quantityConfirmed: item.quantityOrdered.toFixed(3),
    })),
  );
  await createWaybillAndInvoice(orderId, supplier.companyId);
  const invoice = await prisma.document.findFirstOrThrow({ where: { orderId, type: 'INVOICE' } });

  return {
    orderId,
    invoiceId: invoice.id,
    supplierId: supplier.companyId,
    supplierUserId: supplierUser.id,
    storeId: store.companyId,
    storeUserId: storeUser.id,
  };
}

beforeEach(async () => {
  await resetTransactionalData(prisma);
  await prisma.auditLog.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('версии документов', () => {
  it('correction_creates_new_version_and_keeps_old_in_history', async () => {
    const context = await orderWithDocuments(1);
    const before = await prisma.document.findUniqueOrThrow({ where: { id: context.invoiceId } });

    const result = await correctDocument({
      documentId: context.invoiceId,
      companyId: context.supplierId,
      userId: context.supplierUserId,
      reason: 'Неверный адрес доставки',
      deliveryAddress: 'Тараз, ул. Исправленная, 5',
    });
    expect(result).toMatchObject({ status: 'ok', version: 2 });

    const after = await prisma.document.findUniqueOrThrow({ where: { id: context.invoiceId } });
    // Номер и суммы те же, ссылки движений и оплат на документ не меняются.
    expect(after.number).toBe(before.number);
    expect(after.totalWithVat.toFixed(2)).toBe(before.totalWithVat.toFixed(2));
    expect(after.version).toBe(2);

    const old = await documentForPrint(context.invoiceId, context.storeId, 1);
    const current = await documentForPrint(context.invoiceId, context.storeId);
    expect(old!.payload.deliveryAddress).toBe('Тараз, ул. Демонстрационная, 77');
    expect(old!.payload.correction).toBeUndefined();
    expect(current!.payload.deliveryAddress).toBe('Тараз, ул. Исправленная, 5');
    expect(current!.payload.correction).toMatchObject({
      version: 2,
      reason: 'Неверный адрес доставки',
    });

    const versions = await listDocumentVersions(context.invoiceId, context.storeId);
    expect(versions!.map((row) => [row.version, row.current])).toEqual([
      [2, true],
      [1, false],
    ]);
    // В архиве у документа видна текущая версия.
    const archive = await searchDocuments(context.storeId, { type: 'INVOICE' });
    expect(archive[0]!.version).toBe(2);
  });

  it('correction_refreshes_requisites_from_profile', async () => {
    const context = await orderWithDocuments(2);
    await prisma.company.update({
      where: { id: context.supplierId },
      data: { iik: 'KZ07HSBK123456789012', bik: 'HSBKKZKX', bankName: 'Тестовый банк' },
    });

    await correctDocument({
      documentId: context.invoiceId,
      companyId: context.supplierId,
      userId: context.supplierUserId,
      reason: 'Новые реквизиты',
    });

    const current = await documentForPrint(context.invoiceId, context.supplierId);
    expect(current!.payload.supplier.iik).toBe('KZ07HSBK123456789012');
    expect(current!.payload.lines).toEqual(
      (await documentForPrint(context.invoiceId, context.supplierId, 1))!.payload.lines,
    );
  });

  it('only_issuer_corrects_and_outsider_sees_nothing', async () => {
    const context = await orderWithDocuments(3);
    const outsider = await orderWithDocuments(4);

    expect(
      await correctDocument({
        documentId: context.invoiceId,
        companyId: context.storeId,
        userId: context.storeUserId,
        reason: 'Попытка получателя',
      }),
    ).toEqual({ status: 'not_issuer' });
    // Правило 4: посторонняя компания не исправит и не увидит историю и печатную форму.
    expect(
      await correctDocument({
        documentId: context.invoiceId,
        companyId: outsider.supplierId,
        userId: outsider.supplierUserId,
        reason: 'Чужой документ',
      }),
    ).toEqual({ status: 'not_found' });
    expect(await listDocumentVersions(context.invoiceId, outsider.storeId)).toBeNull();
    expect(await documentForPrint(context.invoiceId, outsider.storeId)).toBeNull();
  });

  it('correction_requires_reason_and_is_protected_from_double_click', async () => {
    const context = await orderWithDocuments(5);
    const base = {
      documentId: context.invoiceId,
      companyId: context.supplierId,
      userId: context.supplierUserId,
    };

    expect(await correctDocument({ ...base, reason: '  ' })).toEqual({
      status: 'reason_required',
    });
    expect(await correctDocument({ ...base, reason: 'Адрес', deliveryAddress: ' ' })).toEqual({
      status: 'invalid_address',
    });

    const first = await correctDocument({ ...base, reason: 'Опечатка', idempotencyKey: 'k-5' });
    const again = await correctDocument({ ...base, reason: 'Опечатка', idempotencyKey: 'k-5' });
    expect(first).toMatchObject({ status: 'ok', version: 2, replayed: false });
    expect(again).toMatchObject({ status: 'ok', version: 2, replayed: true });
    expect(await prisma.documentVersion.count({ where: { documentId: context.invoiceId } })).toBe(
      1,
    );
  });

  it('corrected_version_is_signed_again_and_recipient_is_notified', async () => {
    const context = await orderWithDocuments(6);
    await signDocumentByCompany(context.invoiceId, context.supplierId, context.supplierUserId);
    expect(await getSignatures(context.invoiceId)).toHaveLength(1);

    await correctDocument({
      documentId: context.invoiceId,
      companyId: context.supplierId,
      userId: context.supplierUserId,
      reason: 'Опечатка в адресе',
    });

    // Подпись относится к прошлой версии: у новой подписей нет, подписать можно заново.
    expect(await getSignatures(context.invoiceId)).toHaveLength(0);
    const signed = await signDocumentByCompany(
      context.invoiceId,
      context.supplierId,
      context.supplierUserId,
    );
    expect(signed).toMatchObject({ status: 'ok', replayed: false });
    expect(await prisma.documentSignature.count({ where: { documentId: context.invoiceId } })).toBe(
      2,
    );

    const notification = await prisma.notification.findFirstOrThrow({
      where: { event: 'document_corrected' },
    });
    expect(notification.companyId).toBe(context.storeId);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'document_corrected' },
    });
    expect(audit.userId).toBe(context.supplierUserId);
  });
});

describe('свои файлы компании и заявки', () => {
  it('file_type_is_detected_by_content', () => {
    expect(detectFileType(PDF, 'договор.pdf')).toBe('application/pdf');
    expect(detectFileType(PNG, 'фото.png')).toBe('image/png');
    expect(detectFileType(ZIP, 'договор.docx')).toContain('wordprocessingml');
    // HTML под видом PDF и произвольный архив не принимаются.
    expect(detectFileType(HTML, 'счёт.pdf')).toBeNull();
    expect(detectFileType(ZIP, 'архив.zip')).toBeNull();
    expect(safeFileName('../../etc/пароль.pdf')).toBe('пароль.pdf');
  });

  it('order_file_is_visible_to_both_sides_only', async () => {
    const context = await orderWithDocuments(7);
    const outsider = await orderWithDocuments(8);

    const uploaded = await uploadAttachment({
      companyId: context.storeId,
      userId: context.storeUserId,
      orderId: context.orderId,
      kind: 'PHOTO',
      fileName: 'накладная.png',
      data: PNG,
    });
    if (uploaded.status !== 'ok') throw new Error(uploaded.status);

    const forSupplier = await listAttachments(context.supplierId, context.orderId);
    expect(forSupplier).toHaveLength(1);
    expect(forSupplier![0]).toMatchObject({ fileName: 'накладная.png', mine: false });
    expect((await readAttachment(uploaded.id, context.supplierId))!.data).toEqual(PNG);

    // Правило 4: посторонний не видит список, не скачивает и не прикладывает файл.
    expect(await listAttachments(outsider.storeId, context.orderId)).toBeNull();
    expect(await readAttachment(uploaded.id, outsider.storeId)).toBeNull();
    expect(
      await uploadAttachment({
        companyId: outsider.storeId,
        userId: outsider.storeUserId,
        orderId: context.orderId,
        kind: 'PHOTO',
        fileName: 'чужое.png',
        data: PNG,
      }),
    ).toEqual({ status: 'not_found' });
  });

  it('company_file_is_private_and_only_owner_deletes', async () => {
    const context = await orderWithDocuments(9);

    const uploaded = await uploadAttachment({
      companyId: context.supplierId,
      userId: context.supplierUserId,
      kind: 'CERTIFICATE',
      fileName: 'сертификат.pdf',
      data: PDF,
    });
    if (uploaded.status !== 'ok') throw new Error(uploaded.status);

    expect(await listAttachments(context.supplierId)).toHaveLength(1);
    // Файл компании не виден даже контрагенту по заявке.
    expect(await listAttachments(context.storeId)).toEqual([]);
    expect(await readAttachment(uploaded.id, context.storeId)).toBeNull();
    expect(await deleteAttachment(uploaded.id, context.storeId, context.storeUserId)).toBe(
      'not_found',
    );

    expect(await deleteAttachment(uploaded.id, context.supplierId, context.supplierUserId)).toBe(
      'ok',
    );
    expect(await listAttachments(context.supplierId)).toEqual([]);
    expect(await prisma.attachmentBlob.count()).toBe(0);
    const audit = await prisma.auditLog.findMany({
      where: { companyId: context.supplierId, entity: 'Attachment' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((row) => row.action)).toEqual(['attachment_uploaded', 'attachment_deleted']);
  });

  it('wrong_files_are_refused_and_double_click_uploads_once', async () => {
    const context = await orderWithDocuments(10);
    const base = { companyId: context.storeId, userId: context.storeUserId, kind: 'OTHER' };

    expect(
      await uploadAttachment({ ...base, fileName: 'пусто.pdf', data: new Uint8Array() }),
    ).toEqual({ status: 'empty' });
    expect(
      await uploadAttachment({
        ...base,
        fileName: 'большой.pdf',
        data: new Uint8Array(10 * 1024 * 1024 + 1).fill(0x25),
      }),
    ).toEqual({ status: 'too_large' });
    expect(await uploadAttachment({ ...base, fileName: 'страница.pdf', data: HTML })).toEqual({
      status: 'unsupported_type',
    });
    expect(
      await uploadAttachment({ ...base, kind: 'VIRUS', fileName: 'а.pdf', data: PDF }),
    ).toEqual({ status: 'invalid_kind' });

    const first = await uploadAttachment({
      ...base,
      fileName: 'договор.pdf',
      data: PDF,
      idempotencyKey: 'upload-10',
    });
    const again = await uploadAttachment({
      ...base,
      fileName: 'договор.pdf',
      data: PDF,
      idempotencyKey: 'upload-10',
    });
    expect(again).toMatchObject({ status: 'ok', replayed: true });
    expect(first.status === 'ok' && again.status === 'ok' && first.id === again.id).toBe(true);
    expect(await prisma.attachment.count({ where: { companyId: context.storeId } })).toBe(1);
  });
});

describe('документ в Excel (раздел 4.3 ТЗ)', () => {
  it('xlsx_matches_document_totals_in_both_languages', async () => {
    const context = await orderWithDocuments(3);
    const printable = await documentForPrint(context.invoiceId, context.storeId);
    const document = await prisma.document.findUniqueOrThrow({ where: { id: context.invoiceId } });

    for (const locale of ['ru', 'kk'] as const) {
      const file = await documentXlsx(document.type, printable!.payload, locale);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(toArrayBuffer(file));
      const sheet = workbook.worksheets[0]!;
      const cells: unknown[] = [];
      sheet.eachRow((row) => row.eachCell((cell) => cells.push(cell.value)));
      expect(String(cells[0])).toContain(document.number);
      // Итог в Excel — тот же, что в документе, числом с двумя знаками.
      expect(cells).toContain(Number(document.totalWithVat.toFixed(2)));
      expect(cells).toContain(locale === 'ru' ? 'Итого' : LABELS.kk.totals);
    }
  });
});
