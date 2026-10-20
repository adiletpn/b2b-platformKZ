import type { Locale } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { writeAdminAudit } from '@/lib/admin/session';
import type { DocumentPayload } from '@/lib/documents/payload';
import { renderPdf } from '@/lib/documents/pdf';
import { TemplateError, parseTemplate } from '@/lib/documents/template-engine';
import {
  defaultTemplate,
  documentHtml,
  PRINTABLE_TYPES,
  type PrintableType,
} from '@/lib/documents/templates';

/** Редактор печатных форм (раздел 3.13 ТЗ): шаблоны правят Контент-менеджер и Суперадмин. */
export const TEMPLATE_EDITOR_ROLES = ['SUPERADMIN', 'CONTENT_MANAGER'];
export const MAX_TEMPLATE_LENGTH = 100_000;

export function isPrintableType(value: unknown): value is PrintableType {
  return typeof value === 'string' && (PRINTABLE_TYPES as readonly string[]).includes(value);
}

export function isLocale(value: unknown): value is Locale {
  return value === 'ru' || value === 'kk';
}

export type TemplateCheck =
  | { status: 'ok' }
  | { status: 'too_long' }
  | { status: 'empty' }
  | { status: 'syntax_error'; error: string; key: string };

/** Шаблон проверяется до сохранения: сломанный шаблон сломал бы печать у всех компаний. */
export function checkTemplate(body: string): TemplateCheck {
  if (!body.trim()) return { status: 'empty' };
  if (body.length > MAX_TEMPLATE_LENGTH) return { status: 'too_long' };
  try {
    parseTemplate(body);
    return { status: 'ok' };
  } catch (error) {
    if (error instanceof TemplateError) {
      return { status: 'syntax_error', error: error.message, key: error.key };
    }
    throw error;
  }
}

type TemplateProblem = Exclude<TemplateCheck, { status: 'ok' }>;

export type TemplateEditorData = {
  type: PrintableType;
  locale: Locale;
  body: string;
  isDefault: boolean;
  defaultBody: string;
  history: {
    version: number;
    createdAt: string;
    adminName: string;
    isActive: boolean;
    body: string;
  }[];
};

export async function getTemplateEditorData(
  type: PrintableType,
  locale: Locale,
): Promise<TemplateEditorData> {
  const rows = await prisma.documentTemplate.findMany({
    where: { type, locale },
    include: { createdBy: { select: { name: true } } },
    orderBy: { version: 'desc' },
    take: 20,
  });
  const active = rows.find((row) => row.isActive);
  const defaultBody = defaultTemplate(type, locale);
  return {
    type,
    locale,
    body: active?.body ?? defaultBody,
    isDefault: !active,
    defaultBody,
    history: rows.map((row) => ({
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      adminName: row.createdBy.name,
      isActive: row.isActive,
      body: row.body,
    })),
  };
}

export async function saveTemplate(
  adminId: string,
  type: PrintableType,
  locale: Locale,
  body: string,
): Promise<TemplateProblem | { status: 'ok'; version: number }> {
  const check = checkTemplate(body);
  if (check.status !== 'ok') return check;

  const version = await prisma.$transaction(async (tx) => {
    const last = await tx.documentTemplate.findFirst({
      where: { type, locale },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    await tx.documentTemplate.updateMany({ where: { type, locale }, data: { isActive: false } });
    const created = await tx.documentTemplate.create({
      data: { type, locale, body, version: (last?.version ?? 0) + 1, createdById: adminId },
    });
    return created.version;
  });

  await writeAdminAudit(adminId, 'document_template_saved', {
    entity: 'DocumentTemplate',
    entityId: `${type}:${locale}:${version}`,
  });
  return { status: 'ok', version };
}

/** Сброс к стандартному шаблону: прошлые версии остаются в истории. */
export async function resetTemplate(adminId: string, type: PrintableType, locale: Locale) {
  await prisma.documentTemplate.updateMany({ where: { type, locale }, data: { isActive: false } });
  await writeAdminAudit(adminId, 'document_template_reset', {
    entity: 'DocumentTemplate',
    entityId: `${type}:${locale}`,
  });
}

/** Образец документа для предпросмотра: тестовые данные, реальных компаний нет (правило 12). */
export function samplePayload(locale: Locale): DocumentPayload {
  const party = (name: string, bin: string) => ({
    name,
    bin,
    legalAddress: locale === 'kk' ? 'Тараз қ., Демо к-сі, 1' : 'г. Тараз, ул. Демонстрационная, 1',
    iik: 'KZ07HSBK123456789012',
    bik: 'HSBKKZKX',
    bankName: locale === 'kk' ? 'Сынақ банкі' : 'Тестовый банк',
    isVatPayer: true,
  });
  return {
    number: 'З-2-2026-000001',
    issuedAt: '20.10.2026',
    orderNumber: 'ЗАК-2026-000001',
    supplier: party('ТОО «Демо Поставщик» (тест)', '960000000012'),
    store: party('ИП «Демо Магазин» (тест)', '960000000024'),
    deliveryAddress: locale === 'kk' ? 'Тараз, Демо к-сі, 5' : 'Тараз, ул. Демонстрационная, 5',
    lines: [
      {
        position: 1,
        nameRu: 'Молоко 2,5% 1 л (тест)',
        nameKk: 'Сүт 2,5% 1 л (сынақ)',
        unitRu: 'шт',
        unitKk: 'дана',
        quantity: '10.000',
        priceWithoutVat: '400.00',
        vatRate: '16.00',
        vatAmount: '640.00',
        totalWithoutVat: '4000.00',
        totalWithVat: '4640.00',
      },
    ],
    totalWithoutVat: '4000.00',
    vatAmount: '640.00',
    totalWithVat: '4640.00',
    discrepancies: [
      {
        position: 1,
        nameRu: 'Молоко 2,5% 1 л (тест)',
        nameKk: 'Сүт 2,5% 1 л (сынақ)',
        quantityShipped: '10.000',
        quantityAccepted: '9.000',
        quantityDefective: '1.000',
        quantityMismatch: '0.000',
        amountDifference: '464.00',
      },
    ],
  };
}

/** Предпросмотр в PDF на образце, с QR проверки — как документ увидит магазин. */
export async function previewTemplate(
  type: PrintableType,
  locale: Locale,
  body: string,
): Promise<TemplateProblem | { status: 'ok'; pdf: Buffer }> {
  const check = checkTemplate(body);
  if (check.status !== 'ok') return check;
  const html = documentHtml(
    type,
    samplePayload(locale),
    locale,
    {
      verifyUrl: 'https://example.kz/ru/verify/00000000-0000-0000-0000-000000000000?v=1',
    },
    body,
  );
  return { status: 'ok', pdf: await renderPdf(html) };
}
