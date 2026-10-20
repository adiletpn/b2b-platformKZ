import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/auth/permissions';
import { formatDate } from '@/lib/format';
import { withIdempotency } from '@/lib/orders/idempotency';
import { notify } from '@/mocks/notifications';
import { toParty } from './create';
import type { DocumentPayload } from './payload';

export type CorrectionInput = {
  documentId: string;
  companyId: string;
  userId: string;
  reason: string;
  /** Новый адрес доставки; пусто — прежний. */
  deliveryAddress?: string;
  idempotencyKey?: string;
};

export type CorrectionResult =
  | { status: 'ok'; documentId: string; version: number; replayed: boolean }
  | { status: 'not_found' }
  | { status: 'not_issuer' }
  | { status: 'reason_required' }
  | { status: 'invalid_address' }
  | { status: 'conflict' };

/**
 * Раздел 4.3 ТЗ: исправление документа выпускает новую версию, прошлая остаётся в истории.
 * Номер и дата документа сохраняются, в печатной форме появляется отметка об исправлении.
 *
 * Исправляются шапка и реквизиты: данные сторон перечитываются из профилей компаний,
 * можно поправить адрес доставки. Позиции и суммы не меняются — они уже легли в остатки
 * и оплаты.
 * TODO(open-question): исправление количеств и цен после приёмки требует корректировки
 * остатков и взаиморасчётов (корректировочный документ) — порядок согласовать с заказчиком.
 */
export async function correctDocument(input: CorrectionInput): Promise<CorrectionResult> {
  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 500) return { status: 'reason_required' };
  const address = input.deliveryAddress?.trim();
  if (address !== undefined && (address.length === 0 || address.length > 300)) {
    return { status: 'invalid_address' };
  }

  const document = await prisma.document.findUnique({
    where: { id: input.documentId },
    include: { order: { include: { supplier: true, store: true } } },
  });
  // Правило 4: чужой документ не виден вовсе.
  if (
    !document ||
    (document.issuerId !== input.companyId && document.recipientId !== input.companyId)
  ) {
    return { status: 'not_found' };
  }
  // Исправляет только сторона, выписавшая документ.
  if (document.issuerId !== input.companyId) return { status: 'not_issuer' };

  const { result, replayed } = await withIdempotency(
    input.idempotencyKey,
    input.companyId,
    'document_correction',
    async (): Promise<CorrectionResult> => {
      const previous = document.payload as unknown as DocumentPayload;
      const version = document.version + 1;
      const correctedAt = new Date();
      const payload: DocumentPayload = {
        ...previous,
        supplier: toParty(document.order.supplier),
        store: toParty(document.order.store),
        deliveryAddress: address ?? previous.deliveryAddress,
        correction: { version, correctedAt: formatDate(correctedAt), reason },
      };

      const updated = await prisma.$transaction(async (tx) => {
        // Оптимистическая блокировка: два исправления одной версии не проходят оба.
        const changed = await tx.document.updateMany({
          where: { id: document.id, version: document.version },
          data: {
            version,
            payload: payload as never,
            correctionReason: reason,
            correctedAt,
          },
        });
        if (changed.count === 0) return false;

        await tx.documentVersion.create({
          data: {
            documentId: document.id,
            version: document.version,
            payload: document.payload as never,
            totalWithoutVat: document.totalWithoutVat,
            vatAmount: document.vatAmount,
            totalWithVat: document.totalWithVat,
            reason: document.correctionReason,
            supersededAt: correctedAt,
          },
        });
        return true;
      });
      if (!updated) return { status: 'conflict' };

      await writeAudit(
        input.companyId,
        input.userId,
        'document_corrected',
        'Document',
        document.id,
      );
      await notify(
        document.recipientId,
        'document_corrected',
        { number: document.number, version },
        document.orderId,
      );
      return { status: 'ok', documentId: document.id, version, replayed: false };
    },
  );

  return result.status === 'ok' ? { ...result, replayed } : result;
}

export type VersionRow = {
  version: number;
  current: boolean;
  reason: string | null;
  /** Когда версия вышла: дата документа для первой, дата исправления для следующих. */
  date: string;
  totalWithVat: string;
};

/** История версий документа для своей стороны: текущая первой, дальше по убыванию. */
export async function listDocumentVersions(
  documentId: string,
  companyId: string,
): Promise<VersionRow[] | null> {
  const document = await prisma.document.findFirst({
    where: { id: documentId, OR: [{ issuerId: companyId }, { recipientId: companyId }] },
    include: { versions: { orderBy: { version: 'desc' } } },
  });
  if (!document) return null;

  const history = document.versions.map((row, index) => {
    // Версия вышла тогда, когда заменили предыдущую; первая — в день документа.
    const older = document.versions[index + 1];
    return {
      version: row.version,
      current: false,
      reason: row.reason,
      date: formatDate(older ? older.supersededAt : document.issuedAt),
      totalWithVat: row.totalWithVat.toFixed(2),
    };
  });

  return [
    {
      version: document.version,
      current: true,
      reason: document.correctionReason,
      date: formatDate(document.correctedAt ?? document.issuedAt),
      totalWithVat: document.totalWithVat.toFixed(2),
    },
    ...history,
  ];
}

/** Печатная форма нужной версии: текущей или из истории. */
export async function documentForPrint(documentId: string, companyId: string, version?: number) {
  const document = await prisma.document.findFirst({
    where: { id: documentId, OR: [{ issuerId: companyId }, { recipientId: companyId }] },
  });
  if (!document) return null;
  if (version === undefined || version === document.version) {
    return {
      document,
      version: document.version,
      payload: document.payload as unknown as DocumentPayload,
    };
  }

  const old = await prisma.documentVersion.findUnique({
    where: { documentId_version: { documentId, version } },
  });
  if (!old) return null;
  return { document, version, payload: old.payload as unknown as DocumentPayload };
}
