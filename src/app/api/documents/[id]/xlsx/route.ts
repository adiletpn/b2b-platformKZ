import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { documentForPrint } from '@/lib/documents/versions';
import { documentXlsx } from '@/lib/documents/xlsx';

/** Документ в Excel (раздел 4.3 ТЗ). Доступ — как к PDF: только стороны документа. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requirePermission('DOCUMENTS_PAYMENTS', 'VIEW');
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.status === 401 ? 'unauthorized' : 'forbidden' },
      { status: guard.status },
    );
  }

  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const versionParam = search.get('version');
  const version = versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : undefined;

  // Правило 4: документ доступен только своим сторонам.
  const printable = await documentForPrint(id, guard.access.companyId, version);
  if (!printable) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const locale = search.get('locale') === 'kk' ? 'kk' : 'ru';
  const file = await documentXlsx(printable.document.type, printable.payload, locale);
  const fileName = `${printable.document.type}-${printable.document.number}${
    printable.version > 1 ? `-v${printable.version}` : ''
  }.xlsx`;
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, '_');

  return new NextResponse(new Uint8Array(file), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    },
  });
}
