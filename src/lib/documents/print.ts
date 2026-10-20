import type { DocumentType } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import type { DocumentPayload } from './payload';
import { documentHtml, PRINTABLE_TYPES, type PrintOptions } from './templates';

/** Шаблон, сохранённый администратором; `null` — действует стандартный. */
export async function activeTemplateBody(
  type: DocumentType,
  locale: 'ru' | 'kk',
): Promise<string | null> {
  if (!(PRINTABLE_TYPES as readonly string[]).includes(type)) return null;
  const template = await prisma.documentTemplate.findFirst({
    where: { type, locale, isActive: true },
    orderBy: { version: 'desc' },
    select: { body: true },
  });
  return template?.body ?? null;
}

/**
 * HTML печатной формы по действующему шаблону (разделы 3.13 и 4.4 ТЗ).
 * Шаблон меняет вид, а не данные: документ печатается из своего снимка.
 */
export async function printableHtml(
  type: DocumentType,
  payload: DocumentPayload,
  locale: 'ru' | 'kk',
  options: PrintOptions = {},
): Promise<string> {
  return documentHtml(
    type,
    payload,
    locale,
    options,
    (await activeTemplateBody(type, locale)) ?? undefined,
  );
}
