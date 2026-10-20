import { createHash } from 'node:crypto';
import type { AttachmentKind } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/auth/permissions';
import { formatDateTime } from '@/lib/format';
import { withIdempotency } from '@/lib/orders/idempotency';

/**
 * Свои файлы компании и заявки (раздел 4.3 ТЗ): договоры, сертификаты, лицензии, фото.
 * Содержимое лежит в PostgreSQL (`AttachmentBlob`): на Railway диск контейнера стирается
 * при каждом деплое, а база переживает его и попадает в ежедневную копию.
 */
export const ATTACHMENT_KINDS = ['CONTRACT', 'CERTIFICATE', 'LICENSE', 'PHOTO', 'OTHER'] as const;
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Тип определяется по первым байтам, а не по расширению или заголовку браузера:
 * так под видом PDF не загрузить HTML или скрипт.
 */
export function detectFileType(data: Uint8Array, fileName: string): string | null {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
  const extension = fileName.toLowerCase().split('.').pop() ?? '';

  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...data.slice(8, 12)) === 'WEBP') {
    return 'image/webp';
  }
  // DOCX и XLSX — zip-архивы, различаются только расширением.
  if (starts(0x50, 0x4b, 0x03, 0x04)) {
    if (extension === 'docx') {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    if (extension === 'xlsx') {
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
  }
  return null;
}

/** Имя файла без путей и управляющих символов, не длиннее 200 знаков. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return (cleaned || 'file').slice(-200);
}

export type UploadInput = {
  companyId: string;
  userId: string;
  orderId?: string;
  kind: string;
  fileName: string;
  data: Uint8Array;
  idempotencyKey?: string;
};

export type UploadResult =
  | { status: 'ok'; id: string; replayed: boolean }
  | { status: 'empty' }
  | { status: 'too_large' }
  | { status: 'unsupported_type' }
  | { status: 'invalid_kind' }
  | { status: 'not_found' };

/** Заявка, к которой компания может прикладывать и смотреть файлы: только своя сторона. */
async function ownOrder(orderId: string, companyId: string) {
  return prisma.order.findFirst({
    where: { id: orderId, OR: [{ storeId: companyId }, { supplierId: companyId }] },
    select: { id: true },
  });
}

export async function uploadAttachment(input: UploadInput): Promise<UploadResult> {
  if (!(ATTACHMENT_KINDS as readonly string[]).includes(input.kind)) {
    return { status: 'invalid_kind' };
  }
  if (input.data.length === 0) return { status: 'empty' };
  if (input.data.length > MAX_FILE_SIZE) return { status: 'too_large' };

  const fileName = safeFileName(input.fileName);
  const mimeType = detectFileType(input.data, fileName);
  if (!mimeType) return { status: 'unsupported_type' };

  // Правило 4: к чужой заявке файл не приложить.
  if (input.orderId && !(await ownOrder(input.orderId, input.companyId))) {
    return { status: 'not_found' };
  }

  const { result, replayed } = await withIdempotency(
    input.idempotencyKey,
    input.companyId,
    'attachment_upload',
    async (): Promise<UploadResult> => {
      const attachment = await prisma.attachment.create({
        data: {
          companyId: input.companyId,
          orderId: input.orderId ?? null,
          kind: input.kind as AttachmentKind,
          fileName,
          mimeType,
          size: input.data.length,
          sha256: createHash('sha256').update(input.data).digest('hex'),
          uploadedById: input.userId,
          blob: { create: { data: Buffer.from(input.data) } },
        },
      });
      await writeAudit(
        input.companyId,
        input.userId,
        'attachment_uploaded',
        'Attachment',
        attachment.id,
      );
      return { status: 'ok', id: attachment.id, replayed: false };
    },
  );
  return result.status === 'ok' ? { ...result, replayed } : result;
}

export type AttachmentRow = {
  id: string;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  companyName: string;
  /** Загружен своей компанией: его можно удалить. */
  mine: boolean;
};

/**
 * Файлы заявки видят обе её стороны, файлы компании — только сама компания.
 * `null` — заявка чужая.
 */
export async function listAttachments(
  companyId: string,
  orderId?: string,
): Promise<AttachmentRow[] | null> {
  if (orderId && !(await ownOrder(orderId, companyId))) return null;

  const rows = await prisma.attachment.findMany({
    where: orderId ? { orderId } : { companyId, orderId: null },
    include: { company: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.size,
    createdAt: formatDateTime(row.createdAt),
    companyName: row.company.name,
    mine: row.companyId === companyId,
  }));
}

/** Содержимое файла для скачивания с той же проверкой доступа, что и в списке. */
export async function readAttachment(id: string, companyId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: { blob: true, order: { select: { storeId: true, supplierId: true } } },
  });
  if (!attachment?.blob) return null;

  const allowed =
    attachment.companyId === companyId ||
    (attachment.order !== null &&
      (attachment.order.storeId === companyId || attachment.order.supplierId === companyId));
  if (!allowed) return null;

  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    data: new Uint8Array(attachment.blob.data),
  };
}

/** Удалить можно только свой файл; запись остаётся в журнале действий. */
export async function deleteAttachment(
  id: string,
  companyId: string,
  userId: string,
): Promise<'ok' | 'not_found'> {
  const deleted = await prisma.attachment.deleteMany({ where: { id, companyId } });
  if (deleted.count === 0) return 'not_found';
  await writeAudit(companyId, userId, 'attachment_deleted', 'Attachment', id);
  return 'ok';
}
