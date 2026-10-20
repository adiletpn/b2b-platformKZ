import type { DocumentType } from '@/generated/prisma/enums';
import { searchDocuments } from '@/lib/archive/search';
import { exportDocuments } from '@/lib/archive/export';
import { renderPdf } from '@/lib/documents/pdf';
import { documentHtml } from '@/lib/documents/templates';
import { documentForPrint } from '@/lib/documents/versions';
import { verificationUrl } from '@/lib/documents/verification';
import { exportEsf } from './esf';
import { buildZip, type ZipEntry } from './zip';

/** Больше документов за раз не собираем: каждый PDF рендерится браузером. */
export const MAX_BUNDLE_DOCUMENTS = 200;
const MAX_PERIOD_DAYS = 366;

export type BundleInput = {
  companyId: string;
  from: Date;
  to: Date;
  type?: DocumentType;
  locale: 'ru' | 'kk';
  baseUrl: string;
  /** Подписи папок и колонок реестра на языке выгрузки. */
  labels: { types: Record<DocumentType, string>; registry: Record<string, string>; esf: string };
};

export type BundleResult =
  | { status: 'ok'; zip: Buffer; count: number }
  | { status: 'invalid_period' }
  | { status: 'empty' }
  | { status: 'too_many'; limit: number };

/** Имя файла в архиве без разделителей путей. */
function part(value: string) {
  return value.replace(/[\\/:*?"<>|]/g, '-');
}

/**
 * Массовая выгрузка за период одним архивом (раздел 4.4 ТЗ): PDF каждого документа
 * в текущей версии с QR проверки, папки по типам, реестр в Excel и XML ЭСФ своих счетов.
 */
export async function buildDocumentsBundle(input: BundleInput): Promise<BundleResult> {
  const days = (input.to.getTime() - input.from.getTime()) / 86_400_000;
  if (!(days >= 0) || days > MAX_PERIOD_DAYS) return { status: 'invalid_period' };

  // Правило 4: в архив попадают только документы, где компания — сторона.
  const rows = await searchDocuments(
    input.companyId,
    { from: input.from, to: input.to, type: input.type },
    MAX_BUNDLE_DOCUMENTS + 1,
  );
  if (rows.length === 0) return { status: 'empty' };
  if (rows.length > MAX_BUNDLE_DOCUMENTS) {
    return { status: 'too_many', limit: MAX_BUNDLE_DOCUMENTS };
  }

  const entries: ZipEntry[] = [];
  for (const row of rows) {
    const printable = await documentForPrint(row.id, input.companyId);
    if (!printable) continue;
    const html = documentHtml(row.type, printable.payload, input.locale, {
      verifyUrl: verificationUrl(
        input.baseUrl,
        input.locale,
        printable.document.verificationCode,
        printable.version,
      ),
    });
    const suffix = printable.version > 1 ? `-v${printable.version}` : '';
    entries.push({
      name: `${part(input.labels.types[row.type])}/${part(row.number)}${suffix}.pdf`,
      data: await renderPdf(html),
    });

    // ЭСФ выписывает продавец: XML кладём только для своих счетов.
    if (row.type === 'INVOICE' && row.outgoing) {
      const esf = await exportEsf(row.id, input.companyId);
      if (esf.status === 'ok') {
        entries.push({
          name: `${part(input.labels.esf)}/${part(row.number)}.xml`,
          data: new TextEncoder().encode(esf.xml),
        });
      }
    }
  }

  const registry = await exportDocuments(rows, {
    ...input.labels.registry,
    ...input.labels.types,
  });
  entries.push({ name: `${part(input.labels.registry.sheet ?? 'registry')}.xlsx`, data: registry });

  return { status: 'ok', zip: buildZip(entries), count: rows.length };
}
