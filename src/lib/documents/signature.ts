import { prisma } from '@/lib/prisma';
import { signDocument } from '@/mocks/ecp';
import { writeAudit } from '@/lib/auth/permissions';

export type SignResult =
  | { status: 'ok'; signatureId: string; certificate: string; replayed: boolean }
  | { status: 'not_found' }
  | { status: 'not_a_party' };

/**
 * Раздел 4.5 ТЗ: подпись документа ЭЦП. Подписать может только сторона документа,
 * повторная подпись той же компанией не создаётся.
 */
export async function signDocumentByCompany(
  documentId: string,
  companyId: string,
  userId: string,
): Promise<SignResult> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { issuer: true, recipient: true },
  });
  if (!document) return { status: 'not_found' };

  // Правило 4: подписывает только выписавшая или получившая сторона.
  const isParty = document.issuerId === companyId || document.recipientId === companyId;
  if (!isParty) return { status: 'not_a_party' };

  const existing = await prisma.documentSignature.findUnique({
    where: { documentId_companyId: { documentId, companyId } },
  });
  if (existing) {
    return {
      status: 'ok',
      signatureId: existing.id,
      certificate: existing.certificate,
      replayed: true,
    };
  }

  const company = document.issuerId === companyId ? document.issuer : document.recipient;
  const signed = signDocument(document.number, company.bin, company.name);

  const signature = await prisma.documentSignature.create({
    data: {
      documentId,
      companyId,
      signerName: company.name,
      certificate: signed.certificate,
      signature: signed.signature,
    },
  });

  await writeAudit(companyId, userId, 'document_signed', 'Document', documentId);
  return {
    status: 'ok',
    signatureId: signature.id,
    certificate: signed.certificate,
    replayed: false,
  };
}

export type SignatureRow = { companyId: string; signerName: string; signedAt: string };

export async function getSignatures(documentId: string): Promise<SignatureRow[]> {
  const rows = await prisma.documentSignature.findMany({
    where: { documentId },
    orderBy: { signedAt: 'asc' },
  });
  return rows.map((row) => ({
    companyId: row.companyId,
    signerName: row.signerName,
    signedAt: row.signedAt.toISOString(),
  }));
}
