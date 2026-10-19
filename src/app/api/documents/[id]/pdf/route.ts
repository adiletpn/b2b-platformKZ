import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { documentHtml } from '@/lib/documents/templates';
import type { DocumentPayload } from '@/lib/documents/payload';
import { renderPdf } from '@/lib/documents/pdf';
import { prisma } from '@/lib/prisma';

export const maxDuration = 120;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Раздел 3.12 ТЗ: доступ определяется матрицей прав роли.
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const active = await getActiveCompany();
  if (!active) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { id } = await params;
  const document = await prisma.document.findUnique({ where: { id } });
  if (!document) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Правило 4: документ доступен только своим сторонам.
  if (document.issuerId !== active.companyId && document.recipientId !== active.companyId) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const locale = new URL(request.url).searchParams.get('locale') === 'kk' ? 'kk' : 'ru';
  const html = documentHtml(document.type, document.payload as unknown as DocumentPayload, locale);
  const pdf = await renderPdf(html);

  // Номера документов кириллические («З-2-2026-…»), а заголовки допускают только latin-1:
  // имя файла отдаём по RFC 5987.
  const fileName = `${document.type}-${document.number}.pdf`;
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_');

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
