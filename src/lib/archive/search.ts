import type { Prisma } from '@/generated/prisma/client';
import type { DocumentType } from '@/generated/prisma/enums';
import { formatDateTime } from '@/lib/format';
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
  signatures: { signerName: string; signedAt: string; certificate: string }[];
  /** Своя компания уже подписала документ. */
  signedByMe: boolean;
};

/** Архив документов компании с поиском и фильтрами (раздел 4.3 ТЗ). */
export async function searchDocuments(
  companyId: string,
  filters: ArchiveFilters = {},
  limit = 100,
): Promise<ArchiveRow[]> {
  // Условия складываются через AND: у фильтра контрагента и поиска свой OR, и он
  // не должен заменить проверку принадлежности компании.
  const conditions: Prisma.DocumentWhereInput[] = [
    // Правило 4: видны только документы, где компания — одна из сторон.
    { OR: [{ issuerId: companyId }, { recipientId: companyId }] },
  ];
  if (filters.type) conditions.push({ type: filters.type });
  if (filters.counterpartyId) {
    conditions.push({
      OR: [{ issuerId: filters.counterpartyId }, { recipientId: filters.counterpartyId }],
    });
  }
  if (filters.from || filters.to) {
    conditions.push({
      issuedAt: {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      },
    });
  }
  if (filters.minTotal) conditions.push({ totalWithVat: { gte: filters.minTotal } });
  if (filters.search) {
    conditions.push({
      OR: [
        { number: { contains: filters.search, mode: 'insensitive' } },
        { order: { number: { contains: filters.search, mode: 'insensitive' } } },
      ],
    });
  }

  const documents = await prisma.document.findMany({
    where: { AND: conditions },
    include: {
      issuer: { select: { id: true, name: true } },
      recipient: { select: { id: true, name: true } },
      order: { select: { number: true } },
      signatures: { orderBy: { signedAt: 'asc' } },
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
      signatures: document.signatures.map((signature) => ({
        signerName: signature.signerName,
        signedAt: formatDateTime(signature.signedAt),
        certificate: signature.certificate,
      })),
      signedByMe: document.signatures.some((signature) => signature.companyId === companyId),
    };
  });
}
