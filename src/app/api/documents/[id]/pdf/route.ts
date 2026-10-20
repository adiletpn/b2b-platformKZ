import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { getActiveCompany } from '@/lib/auth/active-company';
import { documentHtml } from '@/lib/documents/templates';
import { renderPdf } from '@/lib/documents/pdf';
import { documentForPrint } from '@/lib/documents/versions';

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
  const search = new URL(request.url).searchParams;
  const versionParam = search.get('version');
  const version = versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : undefined;

  // Правило 4: документ доступен только своим сторонам. Раздел 4.3: прошлые версии — из истории.
  const printable = await documentForPrint(id, active.companyId, version);
  if (!printable) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const { document } = printable;

  const locale = search.get('locale') === 'kk' ? 'kk' : 'ru';
  const html = documentHtml(document.type, printable.payload, locale);
  const pdf = await renderPdf(html);

  // Номера документов кириллические («З-2-2026-…»), а заголовки допускают только latin-1:
  // имя файла отдаём по RFC 5987.
  const fileName = `${document.type}-${document.number}${
    printable.version > 1 ? `-v${printable.version}` : ''
  }.pdf`;
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_');

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
