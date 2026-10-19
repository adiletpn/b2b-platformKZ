import type { DocumentType } from '@/generated/prisma/enums';
import { prisma } from '@/lib/prisma';

export type ArchiveFilters = {
  type?: DocumentType;
  counterpartyId?: string;
  from?: Date;
  to?: Date;
  minTotal?: string;
  search?: string;
};

export type ArchiveRow = {
  id: string;
  type: DocumentType;
  number: string;
  issuedAt: string;
  counterpartyName: string;
  orderNumber: string;
  totalWithVat: string;
  version: number;
  outgoing: boolean;
};

/** Архив документов компании с поиском и фильтрами (раздел 4.3 ТЗ). */
export async function searchDocuments(
  companyId: string,
  filters: ArchiveFilters = {},
  limit = 100,
): Promise<ArchiveRow[]> {
  const documents = await prisma.document.findMany({
    where: {
      // Правило 4: видны только документы, где компания — одна из сторон.
      OR: [{ issuerId: companyId }, { recipientId: companyId }],
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.counterpartyId
        ? {
            OR: [{ issuerId: filters.counterpartyId }, { recipientId: filters.counterpartyId }],
          }
        : {}),
      ...(filters.from || filters.to
        ? {
            issuedAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
      ...(filters.minTotal ? { totalWithVat: { gte: filters.minTotal } } : {}),
      ...(filters.search
        ? {
            OR: [
              { number: { contains: filters.search, mode: 'insensitive' as const } },
              { order: { number: { contains: filters.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    },
    include: {
      issuer: { select: { id: true, name: true } },
      recipient: { select: { id: true, name: true } },
      order: { select: { number: true } },
    },
    orderBy: { issuedAt: 'desc' },
    take: limit,
  });

  return documents.map((document) => {
    const outgoing = document.issuerId === companyId;
    return {
      id: document.id,
      type: document.type,
      number: document.number,
      issuedAt: document.issuedAt.toISOString().slice(0, 10),
      counterpartyName: outgoing ? document.recipient.name : document.issuer.name,
      orderNumber: document.order.number,
      totalWithVat: document.totalWithVat.toFixed(2),
      version: document.version,
      outgoing,
    };
  });
}
